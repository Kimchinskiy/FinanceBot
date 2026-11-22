const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');

const router = express.Router();
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || 'https://site.stormkhv.ru/api/integrations/gmail/callback';
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN_KEY = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev_insecure_secret_change_me';

function oauthClient() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function cryptKey() {
  return crypto.createHash('sha256').update(TOKEN_KEY).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}

function decrypt(value) {
  const [ivRaw, tagRaw, dataRaw] = String(value).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', cryptKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

function configured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

const RECEIPT_SENDERS = new Set([
  'echeck@1-ofd.ru', 'noreply@1-ofd.ru', 'noreply@ofd.ru',
  'ofdreceipt@beeline.ru', 'receipt@e-ofd.ru',
]);

function getHeader(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function getPlainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  return (part.parts || []).map(getPlainText).join('\n');
}

function parseReceipt(text, subject) {
  const normalized = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  const match = normalized.match(/(?:итого|сумма|оплачено|к оплате|total)[^\d]{0,35}(\d[\d\s.,]*)\s*(?:₽|руб|RUB)?/i)
    || normalized.match(/(\d[\d\s.,]{2,})\s*(?:₽|руб|RUB)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return null;
  const date = normalized.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  return {
    amount,
    category: 'Прочее',
    description: subject || 'Покупка из Gmail',
    datetime: date ? `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}T12:00:00.000Z` : new Date().toISOString(),
  };
}

async function getGmailConnection(query, userId) {
  const result = await query('SELECT * FROM gmail_connections WHERE user_id = ?', [userId]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  const client = oauthClient();
  client.setCredentials({ access_token: row.access_token || undefined, refresh_token: decrypt(row.refresh_token), expiry_date: row.token_expiry || undefined });
  return { row, client };
}

router.post('/sync', async (req, res) => {
  try {
    const { query } = req.app.locals.db;
    const connection = await getGmailConnection(query, req.userId);
    if (!connection) return res.status(400).json({ error: 'Сначала подключите Gmail' });
    const gmail = google.gmail({ version: 'v1', auth: connection.client });
    const senderQuery = [...RECEIPT_SENDERS].map(s => `from:${s}`).join(' OR ');
    const list = await gmail.users.messages.list({ userId: 'me', q: `newer_than:30d {${senderQuery}}`, maxResults: 50 });
    let created = 0;
    for (const item of list.data.messages || []) {
      const message = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
      const sender = getHeader(message.data, 'From');
      const email = sender.match(/<([^>]+)>/)?.[1]?.toLowerCase() || sender.toLowerCase();
      if (!RECEIPT_SENDERS.has(email)) continue;
      const subject = getHeader(message.data, 'Subject');
      const text = getPlainText(message.data.payload) || message.data.snippet || '';
      const parsed = parseReceipt(text, subject);
      if (!parsed) continue;
      const result = await query(`INSERT OR IGNORE INTO gmail_drafts
        (id, user_id, message_id, sender, subject, amount, category, description, datetime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [Date.now().toString(36) + Math.random().toString(36).slice(2), req.userId, item.id, sender, subject, parsed.amount, parsed.category, parsed.description, parsed.datetime]);
      created += result.rowCount || 0;
    }
    res.json({ ok: true, created });
  } catch (error) {
    console.error('[gmail sync]', error.message);
    res.status(500).json({ error: 'Не удалось проверить Gmail' });
  }
});

router.get('/drafts', async (req, res) => {
  const result = await req.app.locals.db.query(`SELECT id, sender, subject, amount, category, description, datetime, created_at
    FROM gmail_drafts WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC`, [req.userId]);
  res.json(result.rows);
});

router.post('/drafts/:id/approve', async (req, res) => {
  const { query } = req.app.locals.db;
  const result = await query("SELECT * FROM gmail_drafts WHERE id = ? AND user_id = ? AND status = 'pending'", [req.params.id, req.userId]);
  const draft = result.rows[0];
  if (!draft) return res.status(404).json({ error: 'Черновик не найден' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await query('INSERT INTO expenses (id, user_id, amount, category, description, datetime, source) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.userId, draft.amount, draft.category, draft.description, draft.datetime, req.body.source || 'Карта']);
  await query("UPDATE gmail_drafts SET status = 'approved' WHERE id = ? AND user_id = ?", [draft.id, req.userId]);
  res.json({ ok: true, id });
});

router.delete('/drafts/:id', async (req, res) => {
  await req.app.locals.db.query("UPDATE gmail_drafts SET status = 'rejected' WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  res.json({ ok: true });
});

router.get('/status', async (req, res) => {
  const { query } = req.app.locals.db;
  const result = await query('SELECT email, updated_at FROM gmail_connections WHERE user_id = ?', [req.userId]);
  res.json({ configured: configured(), connected: result.rows.length > 0, email: result.rows[0]?.email || null, updatedAt: result.rows[0]?.updated_at || null });
});

router.get('/connect', (req, res) => {
  const client = oauthClient();
  if (!client) return res.status(503).json({ error: 'Gmail OAuth не настроен на сервере' });
  const state = encrypt(JSON.stringify({ userId: req.userId, nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60 * 1000 }));
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
  res.json({ url });
});

// Этот роут монтируется сервером отдельно на /api/integrations/gmail/callback.
// Поэтому здесь путь корневой, иначе получится /callback/callback.
router.get('/', async (req, res) => {
  try {
    const payload = JSON.parse(decrypt(req.query.state || ''));
    if (!payload.userId || payload.exp < Date.now()) throw new Error('OAuth state expired');
    const client = oauthClient();
    if (!client) throw new Error('Gmail OAuth is not configured');
    const { tokens } = await client.getToken(String(req.query.code || ''));
    client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const { query } = req.app.locals.db;
    const current = await query('SELECT refresh_token FROM gmail_connections WHERE user_id = ?', [payload.userId]);
    const refreshToken = tokens.refresh_token || current.rows[0]?.refresh_token;
    if (!refreshToken) throw new Error('Google не вернул refresh token. Повторите подключение.');
    await query(`INSERT OR REPLACE INTO gmail_connections
      (user_id, access_token, refresh_token, token_expiry, email, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [payload.userId, tokens.access_token || null, encrypt(refreshToken), tokens.expiry_date || null, profile.data.emailAddress || null]);
    res.redirect(`${APP_URL}/settings?gmail=connected`);
  } catch (error) {
    console.error('[gmail oauth]', error.message);
    res.redirect(`${APP_URL}/settings?gmail=error`);
  }
});

router.delete('/disconnect', async (req, res) => {
  await req.app.locals.db.query('DELETE FROM gmail_connections WHERE user_id = ?', [req.userId]);
  res.json({ ok: true });
});

module.exports = router;
