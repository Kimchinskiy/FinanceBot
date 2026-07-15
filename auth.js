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

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const pool = req.app.locals.pool;
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже занят' });
    const hash = await bcrypt.hash(password, 10);
    const id = uid();
    await pool.query(
      'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
      [id, email.toLowerCase(), hash]
    );
    await ensureDefaultAccount(pool, id);
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
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
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
router.post('/telegram', async (req, res) => {
  const data = req.body || {};
  if (!verifyTelegramHash(data)) return res.status(401).json({ error: 'Невалидная подпись Telegram' });
  const tgId = String(data.id);
  const pool = req.app.locals.pool;
  try {
    let result = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]);
    let user = result.rows[0];
    if (!user) {
      const id = uid();
      const email = `tg_${tgId}@telegram.local`;
      await pool.query(
        'INSERT INTO users (id, email, tg_id) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [id, email, tgId]
      );
      result = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]);
      user = result.rows[0];
    }
    await ensureDefaultAccount(pool, user.id);
    const token = signToken({ id: user.id, email: user.email, tg_id: user.tg_id });
    res.json({ token, user: { id: user.id, email: user.email, tg_id: user.tg_id, first_name: data.first_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — профиль по токену
router.get('/me', authRequired, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query('SELECT id, email, tg_id, created_at FROM users WHERE id = $1', [req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Создать дефолтный счёт «Наличные», если у пользователя ещё нет счетов
async function ensureDefaultAccount(pool, userId) {
  const r = await pool.query('SELECT COUNT(*) AS c FROM accounts WHERE user_id = $1', [userId]);
  if (Number(r.rows[0].c) === 0) {
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, type, currency, balance)
       VALUES ($1, $2, 'Наличные', 'cash', 'RUB', 0)`,
      [uid(), userId]
    );
  }
}

// Создать/найти пользователя по Telegram ID (использует бот, которому можно доверять)
async function upsertUserByTg(pool, tgId, first_name, username) {
  const idStr = String(tgId);
  let result = await pool.query('SELECT * FROM users WHERE tg_id = $1', [idStr]);
  let user = result.rows[0];
  if (!user) {
    const id = uid();
    const email = `tg_${idStr}@telegram.local`;
    await pool.query(
      'INSERT INTO users (id, email, tg_id) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [id, email, idStr]
    );
    result = await pool.query('SELECT * FROM users WHERE tg_id = $1', [idStr]);
    user = result.rows[0];
  }
  await ensureDefaultAccount(pool, user.id);
  return user;
}

module.exports = { router, authRequired, signToken, verifyToken, upsertUserByTg, ensureDefaultAccount };
