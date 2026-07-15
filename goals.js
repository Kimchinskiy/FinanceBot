// ===================================================================
// FinanceBot — goals.js  (цели накопления + авторасчёт)
// ===================================================================
const express = require('express');
const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// GET /api/goals
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      'SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at ASC',
      [req.userId]
    );
    res.json(result.rows.map(r => ({
      ...r,
      target_amount: parseFloat(r.target_amount),
      current_amount: parseFloat(r.current_amount),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals
router.post('/', async (req, res) => {
  const { title, target_amount, deadline, current_amount } = req.body || {};
  if (!title || !target_amount) return res.status(400).json({ error: 'Укажите название и сумму цели' });
  const pool = req.app.locals.pool;
  try {
    const id = uid();
    await pool.query(
      'INSERT INTO goals (id, user_id, title, target_amount, current_amount, deadline) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.userId, title, parseFloat(target_amount), parseFloat(current_amount) || 0, deadline || null]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', async (req, res) => {
  const { title, target_amount, deadline, current_amount } = req.body || {};
  const pool = req.app.locals.pool;
  try {
    await pool.query(
      `UPDATE goals SET title=$1, target_amount=$2, deadline=$3, current_amount=$4
       WHERE id=$5 AND user_id=$6`,
      [title, parseFloat(target_amount), deadline || null, parseFloat(current_amount) || 0, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/:id/contribute — пополнить цель
router.post('/:id/contribute', async (req, res) => {
  const { amount } = req.body || {};
  const pool = req.app.locals.pool;
  try {
    await pool.query(
      'UPDATE goals SET current_amount = current_amount + $1 WHERE id=$2 AND user_id=$3',
      [parseFloat(amount) || 0, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await pool.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/suggest?amount=100000&date=2026-12-31
// Авторасчёт: сколько откладывать в месяц, чтобы накопить amount к date.
router.get('/suggest', async (req, res) => {
  const amount = parseFloat(req.query.amount);
  const date = req.query.date;
  if (!amount || !date) return res.status(400).json({ error: 'Укажите amount и date' });
  try {
    const months = monthDiff(new Date(), new Date(date));
    const safeMonths = Math.max(months, 1);
    const perMonth = Math.ceil(amount / safeMonths);
    const already = parseFloat(req.query.current_amount) || 0;
    const remaining = Math.max(amount - already, 0);
    res.json({
      target: amount,
      months: safeMonths,
      per_month: Math.ceil(remaining / safeMonths),
      total_months: months,
      by_date: date,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function monthDiff(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

module.exports = router;
