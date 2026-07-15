// ===================================================================
// FinanceBot — accounts.js  (счета и активы пользователя)
// ===================================================================
const express = require('express');
const router = express.Router();
const { fetchCryptoPrices, fetchStockPriceRub } = require('./quotes');

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const SPENDABLE = ['cash', 'card'];
const INVEST = ['deposit', 'crypto', 'broker'];

function normalize(r) {
  return {
    ...r,
    balance: parseFloat(r.balance),
    quantity: r.quantity != null ? parseFloat(r.quantity) : null,
    unit_price: r.unit_price != null ? parseFloat(r.unit_price) : null,
  };
}

// GET /api/accounts — список счетов/активов
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC',
      [req.userId]
    );
    res.json(result.rows.map(normalize));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/total — балансы по группам (для обзора)
router.get('/total', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query('SELECT type, balance FROM accounts WHERE user_id = $1', [req.userId]);
    let spendable = 0, invest = 0;
    result.rows.forEach(r => {
      const b = parseFloat(r.balance) || 0;
      if (SPENDABLE.includes(r.type)) spendable += b; else invest += b;
    });
    res.json({ spendable, invest, netWorth: spendable + invest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts
router.post('/', async (req, res) => {
  const { name, type, currency, balance, symbol, quantity, unit_price, meta } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Укажите название счёта' });
  const pool = req.app.locals.pool;
  try {
    const id = uid();
    const qty = quantity != null ? parseFloat(quantity) : null;
    const price = unit_price != null ? parseFloat(unit_price) : null;
    // Для активов с количеством и ценой стоимость = qty * price
    let value = parseFloat(balance);
    if (qty != null && price != null) value = qty * price;
    if (isNaN(value)) value = 0;
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, type, currency, balance, symbol, quantity, unit_price, meta, price_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, CASE WHEN $9::numeric IS NULL THEN NULL ELSE NOW() END)`,
      [id, req.userId, name, type || 'cash', currency || 'RUB', value,
       symbol || null, qty, price, meta ? JSON.stringify(meta) : '{}']
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  const { name, type, currency, balance, symbol, quantity, unit_price, meta } = req.body || {};
  const pool = req.app.locals.pool;
  try {
    const qty = quantity != null ? parseFloat(quantity) : null;
    const price = unit_price != null ? parseFloat(unit_price) : null;
    let value = parseFloat(balance);
    if (qty != null && price != null) value = qty * price;
    if (isNaN(value)) value = 0;
    await pool.query(
      `UPDATE accounts SET name=$1, type=$2, currency=$3, balance=$4, symbol=$5, quantity=$6, unit_price=$7,
              meta=COALESCE($8::jsonb, meta)
       WHERE id=$9 AND user_id=$10`,
      [name, type || 'cash', currency || 'RUB', value, symbol || null, qty, price,
       meta ? JSON.stringify(meta) : null, req.params.id, req.userId]
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

// POST /api/accounts/refresh-prices — обновить котировки крипты/акций
router.post('/refresh-prices', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const r = await pool.query(
      "SELECT * FROM accounts WHERE user_id=$1 AND type IN ('crypto','broker') AND symbol IS NOT NULL AND quantity IS NOT NULL",
      [req.userId]
    );
    const accounts = r.rows;
    let updated = 0;
    const errors = [];

    // Крипта — батчем
    const cryptos = accounts.filter(a => a.type === 'crypto');
    if (cryptos.length) {
      try {
        const ids = [...new Set(cryptos.map(a => a.symbol))];
        const prices = await fetchCryptoPrices(ids);
        for (const a of cryptos) {
          const price = prices[a.symbol];
          if (price != null) {
            const value = parseFloat(a.quantity) * price;
            await pool.query(
              'UPDATE accounts SET unit_price=$1, balance=$2, price_updated_at=NOW() WHERE id=$3 AND user_id=$4',
              [price, value, a.id, req.userId]
            );
            updated++;
          }
        }
      } catch (e) { errors.push('crypto: ' + e.message); }
    }

    // Акции — по одной
    const stocks = accounts.filter(a => a.type === 'broker');
    for (const a of stocks) {
      try {
        const data = await fetchStockPriceRub(a.symbol);
        if (data && data.priceRub) {
          const value = parseFloat(a.quantity) * data.priceRub;
          await pool.query(
            'UPDATE accounts SET unit_price=$1, balance=$2, price_updated_at=NOW() WHERE id=$3 AND user_id=$4',
            [data.priceRub, value, a.id, req.userId]
          );
          updated++;
        }
      } catch (e) { errors.push(`stock ${a.symbol}: ${e.message}`); }
    }

    const fresh = await pool.query('SELECT * FROM accounts WHERE user_id=$1 ORDER BY created_at ASC', [req.userId]);
    res.json({ updated, errors, accounts: fresh.rows.map(normalize) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
