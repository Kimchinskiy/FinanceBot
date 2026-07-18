// ===================================================================
// FinanceBot — accounts.js  (счета и активы пользователя) — SQLite
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
  const { query } = req.app.locals.db;
  try {
    const result = await query(
      'SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId]
    );
    res.json(result.rows.map(normalize));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/total — балансы по группам (для обзора)
router.get('/total', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const result = await query('SELECT type, balance FROM accounts WHERE user_id = ?', [req.userId]);
    let spendable = 0, invest = 0;
    result.rows.forEach(r => {
      const b = parseFloat(r.balance) || 0;
      if (SPENDABLE.includes(r.type)) spendable += b; else invest += b;
    });
    // total сохранён для обратной совместимости (Telegram-бот)
    res.json({ spendable, invest, netWorth: spendable + invest, total: spendable + invest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts
router.post('/', async (req, res) => {
  const { name, type, currency, balance, symbol, quantity, unit_price, meta } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Укажите название счёта' });
  const { query } = req.app.locals.db;
  try {
    const id = uid();
    const qty = quantity != null ? parseFloat(quantity) : null;
    const price = unit_price != null ? parseFloat(unit_price) : null;
    // Для активов с количеством и ценой стоимость = qty * price
    let value = parseFloat(balance);
    if (qty != null && price != null) value = qty * price;
    if (isNaN(value)) value = 0;
    const priceUpdatedAt = qty != null ? new Date().toISOString() : null;
    await query(
      `INSERT INTO accounts (id, user_id, name, type, currency, balance, symbol, quantity, unit_price, meta, price_updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, name, type || 'cash', currency || 'RUB', value,
       symbol || null, qty, price, meta ? JSON.stringify(meta) : '{}', priceUpdatedAt]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  const { name, type, currency, balance, symbol, quantity, unit_price, meta } = req.body || {};
  const { query } = req.app.locals.db;
  try {
    const qty = quantity != null ? parseFloat(quantity) : null;
    const price = unit_price != null ? parseFloat(unit_price) : null;
    let value = parseFloat(balance);
    if (qty != null && price != null) value = qty * price;
    if (isNaN(value)) value = 0;
    // meta: если передан — обновляем, иначе оставляем прежний
    await query(
      `UPDATE accounts SET name=?, type=?, currency=?, balance=?, symbol=?, quantity=?, unit_price=?,
              meta=COALESCE(?, meta)
       WHERE id=? AND user_id=?`,
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
  const { query } = req.app.locals.db;
  try {
    await query('DELETE FROM accounts WHERE id=? AND user_id=?', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/refresh-prices — обновить котировки крипты/акций
router.post('/refresh-prices', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const r = await query(
      "SELECT * FROM accounts WHERE user_id=? AND type IN ('crypto','broker') AND symbol IS NOT NULL AND quantity IS NOT NULL",
      [req.userId]
    );
    const accounts = r.rows;
    let updated = 0;
    const errors = [];
    const now = new Date().toISOString();

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
            await query(
              'UPDATE accounts SET unit_price=?, balance=?, price_updated_at=? WHERE id=? AND user_id=?',
              [price, value, now, a.id, req.userId]
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
          await query(
            'UPDATE accounts SET unit_price=?, balance=?, price_updated_at=? WHERE id=? AND user_id=?',
            [data.priceRub, value, now, a.id, req.userId]
          );
          updated++;
        }
      } catch (e) { errors.push(`stock ${a.symbol}: ${e.message}`); }
    }

    const fresh = await query('SELECT * FROM accounts WHERE user_id=? ORDER BY created_at ASC', [req.userId]);
    res.json({ updated, errors, accounts: fresh.rows.map(normalize) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
