require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const { createBot, launchBot, stopBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const pool = new Pool({
  user: process.env.DB_USER || 'noc',
  password: process.env.DB_PASSWORD || 'noc',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'financebot',
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await pool.query(
      'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()',
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/incomes', async (req, res) => {
  try {
    const { month, category } = req.query;
    let sql = 'SELECT * FROM incomes';
    const params = [];
    const conditions = [];
    if (month) {
      conditions.push(`datetime::text LIKE $${params.length + 1} || '%'`);
      params.push(month);
    }
    if (category) {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY datetime DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incomes', async (req, res) => {
  try {
    const { amount, category, description, datetime } = req.body;
    const id = uid();
    await pool.query(
      'INSERT INTO incomes (id, amount, category, description, datetime) VALUES ($1, $2, $3, $4, $5)',
      [id, amount, category, description || '', datetime || new Date().toISOString()]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/incomes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM incomes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/expenses', async (req, res) => {
  try {
    const { month, category } = req.query;
    let sql = 'SELECT * FROM expenses';
    const params = [];
    const conditions = [];
    if (month) {
      conditions.push(`datetime::text LIKE $${params.length + 1} || '%'`);
      params.push(month);
    }
    if (category) {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY datetime DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { amount, category, description, datetime } = req.body;
    const id = uid();
    await pool.query(
      'INSERT INTO expenses (id, amount, category, description, datetime) VALUES ($1, $2, $3, $4, $5)',
      [id, amount, category, description || '', datetime || new Date().toISOString()]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mandatory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mandatory_payments ORDER BY day ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mandatory', async (req, res) => {
  try {
    const { name, amount, category, day, type, status } = req.body;
    const id = uid();
    await pool.query(
      'INSERT INTO mandatory_payments (id, name, amount, category, day, type, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, amount, category, day || null, type || 'monthly', status || 'pending']
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mandatory/:id', async (req, res) => {
  try {
    const { name, amount, category, day, type, status } = req.body;
    await pool.query(
      'UPDATE mandatory_payments SET name = $1, amount = $2, category = $3, day = $4, type = $5, status = $6 WHERE id = $7',
      [name, amount, category, day, type, status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mandatory/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mandatory_payments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/mandatory/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      `UPDATE mandatory_payments SET status = CASE WHEN status = 'paid' THEN 'pending' ELSE 'paid' END WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const bot = createBot(process.env.BOT_TOKEN, APP_URL);
if (bot) launchBot();

app.listen(PORT, () => {
  console.log(`📊 FinanceBot API running at http://localhost:${PORT}`);
});

process.once('SIGINT', () => { stopBot(); process.exit(0); });
process.once('SIGTERM', () => { stopBot(); process.exit(0); });
