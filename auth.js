// ===================================================================
// FinanceBot — auth.js
// Регистрация/вход по email+паролю и вход через Telegram Login Widget.
// Выдаёт JWT. Middleware authRequired защищает роуты.
// ===================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_insecure_secret_change_me';
const TOKEN_TTL = '30d';
const BOT_TOKEN = process.env.BOT_TOKEN;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email || null, tg: user.tg_id || null }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Express-middleware: требует валидный Bearer-токен, проставляет req.userId
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = verifyToken(match[1]);
    req.userId = payload.sub;
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// Проверка подписи Telegram Login Widget
// data_check_string = отсортированные "key=value" (кроме hash)
// secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string)
function verifyTelegramHash(data) {
  if (!BOT_TOKEN) return false;
  const { hash, ...rest } = data;
  if (!hash) return false;
  const checkString = Object.keys(rest)
    .filter(k => rest[k] !== undefined && rest[k] !== null && rest[k] !== '')
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computed = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return computed === hash;
}

const router = express.Router();

// GET /api/auth/config — публично: открыта ли регистрация
router.get('/config', (req, res) => {
  res.json({ allowRegister: process.env.OPEN_REGISTER !== 'false' });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  if (process.env.OPEN_REGISTER === 'false') {
    return res.status(403).json({ error: 'Регистрация закрыта' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const { query } = req.app.locals.db;
  try {
    const exists = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже занят' });
    const hash = await bcrypt.hash(password, 10);
    const id = uid();
    await query(
      'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      [id, email.toLowerCase(), hash]
    );
    await ensureDefaultAccount(query, id);
    const token = signToken({ id, email: email.toLowerCase() });
    res.json({ token, user: { id, email: email.toLowerCase() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
  const { query } = req.app.locals.db;
  try {
    const result = await query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Неверный email или пароль' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    const token = signToken({ id: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/telegram  (Telegram Login Widget)
// Если передан валидный JWT (заголовок Authorization) — привязываем tg_id к
// текущему аккаунту (link). Иначе ищем пользователя по tg_id; если нет —
// создаём нового. Если по tg_id найден существующий аккаунт (даже с email) —
// логиним именно его.
router.post('/telegram', async (req, res) => {
  const data = req.body || {};
  if (!verifyTelegramHash(data)) return res.status(401).json({ error: 'Невалидная подпись Telegram' });
  const tgId = String(data.id);
  const { query } = req.app.locals.db;
  try {
    // Привязка к уже авторизованному аккаунту
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m) {
      try {
        const payload = verifyToken(m[1]);
        await query('UPDATE users SET tg_id = ? WHERE id = ?', [tgId, payload.sub]);
        const r = await query('SELECT * FROM users WHERE id = ?', [payload.sub]);
        const user = r.rows[0];
        await ensureDefaultAccount(query, user.id);
        const token = signToken({ id: user.id, email: user.email, tg_id: user.tg_id });
        return res.json({ token, user: { id: user.id, email: user.email, tg_id: user.tg_id, first_name: data.first_name } });
      } catch (_) { /* невалидный токен — падаем ниже в обычный логин */ }
    }

    let result = await query('SELECT * FROM users WHERE tg_id = ?', [tgId]);
    let user = result.rows[0];
    if (!user) {
      const id = uid();
      const email = `tg_${tgId}@telegram.local`;
      await query(
        'INSERT OR IGNORE INTO users (id, email, tg_id) VALUES (?, ?, ?)',
        [id, email, tgId]
      );
      result = await query('SELECT * FROM users WHERE tg_id = ?', [tgId]);
      user = result.rows[0];
    }
    await ensureDefaultAccount(query, user.id);
    const token = signToken({ id: user.id, email: user.email, tg_id: user.tg_id });
    res.json({ token, user: { id: user.id, email: user.email, tg_id: user.tg_id, first_name: data.first_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/link-telegram — привязать Telegram к аккаунту (требует авторизации)
router.post('/link-telegram', authRequired, async (req, res) => {
  const data = req.body || {};
  if (!verifyTelegramHash(data)) return res.status(401).json({ error: 'Невалидная подпись Telegram' });
  const tgId = String(data.id);
  const { query } = req.app.locals.db;
  try {
    // Если этот tg_id уже привязан к ДРУГОМУ аккаунту — отказываем
    const existing = await query('SELECT id FROM users WHERE tg_id = ? AND id != ?', [tgId, req.userId]);
    if (existing.rows.length) return res.status(409).json({ error: 'Этот Telegram уже привязан к другому аккаунту' });
    await query('UPDATE users SET tg_id = ? WHERE id = ?', [tgId, req.userId]);
    res.json({ ok: true, tg_id: tgId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — профиль по токену
router.get('/me', authRequired, async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const result = await query('SELECT id, email, tg_id, created_at FROM users WHERE id = ?', [req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Создать дефолтные счета «Наличные» и «Карта», если их ещё нет
async function ensureDefaultAccount(query, userId) {
  const defaults = [
    { name: 'Наличные', type: 'cash' },
    { name: 'Карта',    type: 'card' },
  ];
  for (const acc of defaults) {
    const r = await query(
      'SELECT 1 FROM accounts WHERE user_id = ? AND name = ?',
      [userId, acc.name]
    );
    if (!r.rows.length) {
      await query(
        `INSERT INTO accounts (id, user_id, name, type, currency, balance)
         VALUES (?, ?, ?, ?, 'RUB', 0)`,
        [uid(), userId, acc.name, acc.type]
      );
    }
  }
}

// Создать/найти пользователя по Telegram ID (использует бот, которому можно доверять)
async function upsertUserByTg(query, tgId, first_name, username) {
  const idStr = String(tgId);
  let result = await query('SELECT * FROM users WHERE tg_id = ?', [idStr]);
  let user = result.rows[0];
  if (!user) {
    const id = uid();
    const email = `tg_${idStr}@telegram.local`;
    await query(
      'INSERT OR IGNORE INTO users (id, email, tg_id) VALUES (?, ?, ?)',
      [id, email, idStr]
    );
    result = await query('SELECT * FROM users WHERE tg_id = ?', [idStr]);
    user = result.rows[0];
  }
  await ensureDefaultAccount(query, user.id);
  return user;
}

module.exports = { router, authRequired, signToken, verifyToken, upsertUserByTg, ensureDefaultAccount };
