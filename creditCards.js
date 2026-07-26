const express = require('express');
const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

router.get('/', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const r = await query('SELECT * FROM credit_cards WHERE user_id = ? ORDER BY created_at ASC', [req.userId]);
    const cards = r.rows.map(c => ({ ...c, balance: Number(c.balance), limit_amount: Number(c.limit_amount) }));
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { query } = req.app.locals.db;
  const { name, limit_amount, closing_date, payment_date } = req.body || {};
  if (!name || !limit_amount) return res.status(400).json({ error: 'Название и лимит обязательны' });
  try {
    const id = uid();
    await query(
      'INSERT INTO credit_cards (id, user_id, name, limit_amount, balance, closing_date, payment_date) VALUES (?,?,?,?,0,?,?)',
      [id, req.userId, name, Number(limit_amount), closing_date || null, payment_date || null]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { query } = req.app.locals.db;
  const { name, limit_amount, closing_date, payment_date } = req.body || {};
  try {
    await query(
      `UPDATE credit_cards SET name=COALESCE(?,name), limit_amount=COALESCE(?,limit_amount),
       closing_date=COALESCE(?,closing_date), payment_date=COALESCE(?,payment_date)
       WHERE id=? AND user_id=?`,
      [name || null, limit_amount ? Number(limit_amount) : null, closing_date ?? null, payment_date ?? null, req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    await query('DELETE FROM credit_card_transactions WHERE card_id=? AND user_id=?', [req.params.id, req.userId]);
    await query('DELETE FROM credit_cards WHERE id=? AND user_id=?', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/transactions', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const r = await query(
      'SELECT * FROM credit_card_transactions WHERE card_id=? AND user_id=? ORDER BY datetime DESC',
      [req.params.id, req.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/purchase', async (req, res) => {
  const { query } = req.app.locals.db;
  const { amount, description, category, datetime } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Сумма обязательна' });
  try {
    const card = await query('SELECT * FROM credit_cards WHERE id=? AND user_id=?', [req.params.id, req.userId]);
    if (!card.rows[0]) return res.status(404).json({ error: 'Карта не найдена' });
    const txnId = uid();
    const amt = Number(amount);
    await query(
      'INSERT INTO credit_card_transactions (id, user_id, card_id, type, amount, description, category, datetime) VALUES (?,?,?,?,?,?,?,?)',
      [txnId, req.userId, req.params.id, 'purchase', amt, description || '', category || null, datetime || new Date().toISOString()]
    );
    await query('UPDATE credit_cards SET balance = balance + ? WHERE id=? AND user_id=?', [amt, req.params.id, req.userId]);
    res.json({ id: txnId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/payment', async (req, res) => {
  const { query } = req.app.locals.db;
  const { amount, description, source, datetime } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Сумма обязательна' });
  const src = source || 'Карта';
  try {
    const card = await query('SELECT * FROM credit_cards WHERE id=? AND user_id=?', [req.params.id, req.userId]);
    if (!card.rows[0]) return res.status(404).json({ error: 'Карта не найдена' });
    const txnId = uid();
    const amt = Number(amount);
    await query(
      'INSERT INTO credit_card_transactions (id, user_id, card_id, type, amount, description, datetime) VALUES (?,?,?,?,?,?,?)',
      [txnId, req.userId, req.params.id, 'payment', amt, description || '', datetime || new Date().toISOString()]
    );
    await query('UPDATE credit_cards SET balance = balance - ? WHERE id=? AND user_id=?', [amt, req.params.id, req.userId]);
    await query(
      `UPDATE accounts SET balance = balance - ? WHERE id = (
         SELECT id FROM accounts WHERE user_id = ?
         ORDER BY (name = ?) DESC, created_at ASC LIMIT 1
       )`,
      [amt, req.userId, src]
    );
    res.json({ id: txnId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
