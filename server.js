require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { query } = require('./db');
const { createBot, launchBot, stopBot } = require('./bot');
const { router: authRouter, authRequired, upsertUserByTg, signToken } = require('./auth');
const accountsRouter = require('./accounts');
const goalsRouter = require('./goals');
const aiRouter = require('./ai');
const creditCardsRouter = require('./creditCards');
const { router: quotesRouter } = require('./quotes');
const { runMigration } = require('./migrate');
const { currentMonthVladivostok, nowVladivostokIso } = require('./timezone');
const { withUserLock } = require('./lock');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Делаем db-обёртку доступной в роутах через req.app.locals
app.locals.db = { query };

// Разрешаем CORS только с адреса самого приложения — фронтенд всё равно
// раздаётся с того же origin, так что это не ломает штатную работу, но не
// позволяет постороннему сайту дёргать API из браузера с чужим origin.
const allowedOrigin = APP_URL.replace(/\/$/, '');
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origin === allowedOrigin),
}));
app.use(express.json());

function parseAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Первый зарегистрированный реальный пользователь считается администратором
// инстанса — только ему можно менять общий AI-ключ/провайдера/модель,
// иначе любой зарегистрировавшийся смог бы подменить их всем остальным.
async function isAdmin(userId) {
  const r = await query("SELECT id FROM users WHERE id != 'system' ORDER BY created_at ASC LIMIT 1");
  return r.rows[0]?.id === userId;
}

// Статика собранного React-фронта (Vite), если собран
const WEB_DIST = path.join(__dirname, 'web', 'dist');
const hasWebDist = fs.existsSync(WEB_DIST);

if (hasWebDist) {
  app.use(express.static(WEB_DIST, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (/\.(html|css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
} else {
  // Fallback: старый ванильный фронт (до сборки React)
  app.use(express.static(path.join(__dirname), {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (/\.(html|css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ──────────────────── AUTH (публично) ──────────────────── */
app.use('/api/auth', authRouter);

/* ──────────────────── SETTINGS (per-user) ──────────────────── */
app.get('/api/settings', authRequired, async (req, res) => {
  try {
    const result = await query('SELECT key, value FROM settings WHERE user_id = ?', [req.userId]);
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Настройки AI-провайдера общие для всего инстанса, а не per-user
const AI_SYSTEM_SETTING_KEYS = ['openrouter_key', 'openrouter_model', 'gemini_key', 'gemini_model', 'ai_provider'];

app.put('/api/settings/:key', authRequired, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const isSystemKey = AI_SYSTEM_SETTING_KEYS.includes(key);
    if (isSystemKey && !(await isAdmin(req.userId))) {
      return res.status(403).json({ error: 'Только администратор может менять AI-настройки' });
    }
    const uid = isSystemKey ? 'system' : req.userId;
    await query(
      `INSERT OR REPLACE INTO settings (user_id, key, value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [uid, key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────── INCOMES (per-user) ──────────────────── */
app.get('/api/incomes', authRequired, async (req, res) => {
  try {
    const { month, category } = req.query;
    let sql = 'SELECT * FROM incomes WHERE user_id = ?';
    const params = [req.userId];
    const conditions = [];
    if (month) { conditions.push(`datetime LIKE ? || '%'`); params.push(month); }
    if (category) { conditions.push(`category = ?`); params.push(category); }
    if (conditions.length) sql += ' AND ' + conditions.join(' AND ');
    sql += ' ORDER BY datetime DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incomes', authRequired, async (req, res) => {
  try {
    const { category, description, datetime, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    const id = uid();
    await query(
      'INSERT INTO incomes (id, user_id, amount, category, description, datetime, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.userId, amt, category, description || '', datetime || new Date().toISOString(), src]
    );
    // Пополняем счёт, соответствующий источнику (по имени), иначе — первый счёт пользователя
    await query(
      `UPDATE accounts SET balance = balance + ? WHERE id = (
         SELECT id FROM accounts WHERE user_id = ?
         ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
       )`,
      [amt, req.userId, src]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/incomes/:id', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      const old = await query('SELECT * FROM incomes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (!old.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      const oldRow = old.rows[0];
      const { category, description, datetime, source } = req.body;
      const amt = parseAmount(req.body.amount);
      if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
      const src = source || 'Карта';

      await query(
        `UPDATE incomes SET amount = ?, category = ?, description = ?, datetime = ?, source = ?
         WHERE id = ? AND user_id = ?`,
        [amt, category, description || '', datetime || oldRow.datetime, src, req.params.id, req.userId]
      );

      // Пересчитываем баланс: возвращаем старую сумму, списываем новую
      if (Number(oldRow.amount) !== amt || (oldRow.source || 'Карта') !== src) {
        const oldSrc = oldRow.source || 'Карта';
        await query(
          `UPDATE accounts SET balance = balance - ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [Number(oldRow.amount), req.userId, oldSrc]
        );
        await query(
          `UPDATE accounts SET balance = balance + ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [amt, req.userId, src]
        );
      }
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/incomes/:id', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      const r = await query('SELECT amount, source FROM incomes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (r.rows[0]) {
        const src = r.rows[0].source || 'Карта';
        await query(
          `UPDATE accounts SET balance = balance - ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [r.rows[0].amount, req.userId, src]
        );
      }
      await query('DELETE FROM incomes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────── EXPENSES (per-user) ──────────────────── */
app.get('/api/expenses', authRequired, async (req, res) => {
  try {
    const { month, category } = req.query;
    let sql = 'SELECT * FROM expenses WHERE user_id = ?';
    const params = [req.userId];
    const conditions = [];
    if (month) { conditions.push(`datetime LIKE ? || '%'`); params.push(month); }
    if (category) { conditions.push(`category = ?`); params.push(category); }
    if (conditions.length) sql += ' AND ' + conditions.join(' AND ');
    sql += ' ORDER BY datetime DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', authRequired, async (req, res) => {
  try {
    const { category, description, datetime, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    const id = uid();
    await query(
      'INSERT INTO expenses (id, user_id, amount, category, description, datetime, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.userId, amt, category, description || '', datetime || new Date().toISOString(), src]
    );
    // Списываем со счёта, соответствующего источнику (по имени), иначе — с первого счёта
    await query(
      `UPDATE accounts SET balance = balance - ? WHERE id = (
         SELECT id FROM accounts WHERE user_id = ?
         ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
       )`,
      [amt, req.userId, src]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/expenses/:id', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      const old = await query('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (!old.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      const oldRow = old.rows[0];
      const { category, description, datetime, source } = req.body;
      const amt = parseAmount(req.body.amount);
      if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
      const src = source || 'Карта';

      await query(
        `UPDATE expenses SET amount = ?, category = ?, description = ?, datetime = ?, source = ?
         WHERE id = ? AND user_id = ?`,
        [amt, category, description || '', datetime || oldRow.datetime, src, req.params.id, req.userId]
      );

      // Пересчитываем баланс: возвращаем старую сумму, добавляем новую
      if (Number(oldRow.amount) !== amt || (oldRow.source || 'Карта') !== src) {
        const oldSrc = oldRow.source || 'Карта';
        await query(
          `UPDATE accounts SET balance = balance + ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [Number(oldRow.amount), req.userId, oldSrc]
        );
        await query(
          `UPDATE accounts SET balance = balance - ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [amt, req.userId, src]
        );
      }
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      const r = await query('SELECT amount, source FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (r.rows[0]) {
        const src = r.rows[0].source || 'Карта';
        await query(
          `UPDATE accounts SET balance = balance + ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [r.rows[0].amount, req.userId, src]
        );
      }
      await query('DELETE FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────── MANDATORY (per-user) ──────────────────── */
// Автосброс "оплачено" → "ожидает" при наступлении нового месяца
// (по владивостокскому времени), чтобы обязательные платежи обновлялись
// сами каждый месяц без ручного вмешательства.
async function resetStaleMandatory(userId) {
  const nowMonth = currentMonthVladivostok();
  const nowIso = nowVladivostokIso();
  await query(
    `UPDATE mandatory_payments
     SET status = 'pending', status_updated_at = ?
     WHERE user_id = ? AND status = 'paid'
       AND strftime('%Y-%m', COALESCE(status_updated_at, created_at)) <> ?`,
    [nowIso, userId, nowMonth]
  );
}

app.get('/api/mandatory', authRequired, async (req, res) => {
  try {
    await resetStaleMandatory(req.userId);
    const result = await query('SELECT * FROM mandatory_payments WHERE user_id = ? ORDER BY day ASC', [req.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mandatory', authRequired, async (req, res) => {
  try {
    const { name, category, day, type, status, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    const id = uid();
    await query(
      'INSERT INTO mandatory_payments (id, user_id, name, amount, category, day, type, status, source, status_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.userId, name, amt, category, day || null, type || 'monthly', status || 'pending', src, nowVladivostokIso()]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mandatory/:id', authRequired, async (req, res) => {
  try {
    const { name, category, day, type, status, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    await query(
      `UPDATE mandatory_payments SET name = ?, amount = ?, category = ?, day = ?, type = ?, status = ?, source = ?, status_updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [name, amt, category, day || null, type, status, src, nowVladivostokIso(), req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mandatory/:id', authRequired, async (req, res) => {
  try {
    await query('DELETE FROM mandatory_payments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/mandatory/:id/toggle', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      await resetStaleMandatory(req.userId);
      const row = await query('SELECT amount, status, source FROM mandatory_payments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (!row.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      const wasPaid = row.rows[0].status === 'paid';
      const src = row.rows[0].source || 'Карта';

      await query(
        `UPDATE mandatory_payments SET status = CASE WHEN status = 'paid' THEN 'pending' ELSE 'paid' END,
         status_updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [nowVladivostokIso(), req.params.id, req.userId]
      );

      const amt = Number(row.rows[0].amount);
      if (wasPaid) {
        await query(
          `UPDATE accounts SET balance = balance + ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [amt, req.userId, src]
        );
      } else {
        await query(
          `UPDATE accounts SET balance = balance - ? WHERE id = (
             SELECT id FROM accounts WHERE user_id = ?
             ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
           )`,
          [amt, req.userId, src]
        );
      }
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────── DEBTS (per-user) ──────────────────── */
app.get('/api/debts', authRequired, async (req, res) => {
  try {
    const result = await query('SELECT * FROM debts WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debts', authRequired, async (req, res) => {
  try {
    const { person, note, direction, status, due_date, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    const id = uid();
    await query(
      'INSERT INTO debts (id, user_id, person, amount, note, direction, status, due_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.userId, person, amt, note || '', direction || 'i_owe', status || 'pending', due_date || null, src]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/debts/:id', authRequired, async (req, res) => {
  try {
    const { person, note, direction, status, due_date, source } = req.body;
    const amt = parseAmount(req.body.amount);
    if (amt === null) return res.status(400).json({ error: 'Некорректная сумма' });
    const src = source || 'Карта';
    await query(
      `UPDATE debts SET person = ?, amount = ?, note = ?, direction = ?, status = ?, due_date = ?, source = ?
       WHERE id = ? AND user_id = ?`,
      [person, amt, note || '', direction, status, due_date || null, src, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/debts/:id', authRequired, async (req, res) => {
  try {
    await query('DELETE FROM debts WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/debts/:id/toggle', authRequired, async (req, res) => {
  try {
    await withUserLock(req.userId, async () => {
      const row = await query('SELECT amount, status, direction, source FROM debts WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (!row.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      const wasPaid = row.rows[0].status === 'paid';
      const direction = row.rows[0].direction;
      const src = row.rows[0].source || 'Карта';

      await query(
        `UPDATE debts SET status = CASE WHEN status = 'paid' THEN 'pending' ELSE 'paid' END
         WHERE id = ? AND user_id = ?`,
        [req.params.id, req.userId]
      );

      const amt = Number(row.rows[0].amount);
      if (direction === 'i_owe') {
        if (wasPaid) {
          // Возврат отметки → деньги возвращаются на счёт
          await query(
            `UPDATE accounts SET balance = balance + ? WHERE id = (
               SELECT id FROM accounts WHERE user_id = ?
               ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
             )`,
            [amt, req.userId, src]
          );
        } else {
          // Отмечаем оплаченным → списываем со счёта
          await query(
            `UPDATE accounts SET balance = balance - ? WHERE id = (
               SELECT id FROM accounts WHERE user_id = ?
               ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
             )`,
            [amt, req.userId, src]
          );
        }
      }
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────── ACCOUNTS / GOALS / AI / CREDIT CARDS (per-user) ──────────────────── */
app.use('/api/accounts', authRequired, accountsRouter);
app.use('/api/goals', authRequired, goalsRouter);
app.use('/api/ai', authRequired, aiRouter);
app.use('/api/quotes', authRequired, quotesRouter);
app.use('/api/credit-cards', authRequired, creditCardsRouter);

/* ──────────────────── SPA FALLBACK (React) ──────────────────── */
// Все не-API GET-запросы отдаём index.html собранного фронта
if (hasWebDist) {
  app.get(/^\/(?!api\/|telegram_callback).*/, (req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

/* ──────────────────── TELEGRAM LOGIN CALLBACK ──────────────────── */
// Telegram Login Widget редиректит сюда, мы перенаправляем в приложение (URL scheme).
app.get('/telegram_callback', (req, res) => {
  const q = Object.entries(req.query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  res.type('html').send(
    `<!doctype html><html><head><meta charset="utf-8"><title>FinanceBot</title></head>` +
    `<body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:40px;background:#f5f5f7;color:#1d1d1f">` +
    `Перенаправление в приложение…<script>location.href='finabot://auth?${q}';</script>` +
    `</body></html>`
  );
});

/* ──────────────────── BOT ──────────────────── */
(async () => {
  // Авто-миграция БД при старте (idempotent — безопасно при повторном запуске)
  try {
    runMigration();
    console.log('✅ DB migration applied');
  } catch (e) {
    console.error('❌ Migration error:', e.message);
  }

  const bot = createBot(process.env.BOT_TOKEN, APP_URL, { query });
  if (bot) launchBot();

  // Загружаем OpenRouter ключ из настроек, если есть
  try {
  const r = await query("SELECT value FROM settings WHERE user_id='system' AND key='openrouter_key'");
    if (r.rows[0]?.value && !process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_APi) {
      process.env.OPENROUTER_API_KEY = JSON.parse(r.rows[0].value);
    }
  } catch {} // не критично

  app.listen(PORT, () => {
    console.log(`📊 FinanceBot API running at http://localhost:${PORT}`);
  });
})();

process.once('SIGINT', () => { stopBot(); process.exit(0); });
process.once('SIGTERM', () => { stopBot(); process.exit(0); });
