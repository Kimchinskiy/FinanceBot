// ===================================================================
// FinanceBot — accounts.js  (счета пользователя)
// ===================================================================
const express = require('express');
const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// GET /api/accounts — список счетов
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC',
      [req.userId]
    );
    res.json(result.rows.map(r => ({ ...r, balance: parseFloat(r.balance) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/total — сумма балансов (для дашборда)
router.get('/total', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      'SELECT COALESCE(SUM(balance), 0) AS total FROM accounts WHERE user_id = $1',
      [req.userId]
    );
    res.json({ total: parseFloat(result.rows[0].total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts
router.post('/', async (req, res) => {
  const { name, type, currency, balance } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Укажите название счёта' });
  const pool = req.app.locals.pool;
  try {
    const id = uid();
    await pool.query(
      'INSERT INTO accounts (id, user_id, name, type, currency, balance) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.userId, name, type || 'cash', currency || 'RUB', parseFloat(balance) || 0]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  const { name, type, currency, balance } = req.body || {};
  const pool = req.app.locals.pool;
  try {
    await pool.query(
      `UPDATE accounts SET name=$1, type=$2, currency=$3, balance=$4
       WHERE id=$5 AND user_id=$6`,
      [name, type || 'cash', currency || 'RUB', parseFloat(balance) || 0, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await pool.query('DELETE FROM accounts WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
