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

router.get('/callback', async (req, res) => {
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
