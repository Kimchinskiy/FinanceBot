// ===================================================================
// FinanceBot — quotes.js
// Котировки активов: криптовалюта (CoinGecko, без ключа) и акции
// (Finnhub, опционально по ключу STOCK_API_KEY). Всё приводится к RUB.
// ===================================================================
const express = require('express');
const router = express.Router();

const COINGECKO = 'https://api.coingecko.com/api/v3';
const FINNHUB = 'https://finnhub.io/api/v1';
const STOCK_API_KEY = process.env.STOCK_API_KEY || '';

// Небольшой кэш курса USD→RUB (на 1 час), чтобы не дёргать API постоянно
let _usdRub = { value: null, ts: 0 };

async function getUsdRub() {
  const now = Date.now();
  if (_usdRub.value && now - _usdRub.ts < 3600_000) return _usdRub.value;
  // Пробуем несколько источников по очереди
  const sources = [
    async () => {
      const r = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=RUB');
      const j = await r.json();
      return j && j.rates && j.rates.RUB;
    },
    async () => {
      // ЦБ РФ
      const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      const j = await r.json();
      return j && j.Valute && j.Valute.USD && j.Valute.USD.Value;
    },
    async () => {
      // Через CoinGecko: цена tether (~$1) в rub
      const r = await fetch(`${COINGECKO}/simple/price?ids=tether&vs_currencies=rub`);
      const j = await r.json();
      return j && j.tether && j.tether.rub;
    },
  ];
  for (const src of sources) {
    try {
      const v = await src();
      if (v && Number(v) > 0) {
        _usdRub = { value: Number(v), ts: now };
        return _usdRub.value;
      }
    } catch (_) { /* пробуем следующий */ }
  }
  // Фолбэк, если все источники недоступны
  return _usdRub.value || 90;
}

// Цены криптовалют в RUB. ids — массив coingecko id (bitcoin, ethereum, ...)
async function fetchCryptoPrices(ids) {
  if (!ids || !ids.length) return {};
  const list = ids.join(',');
  const r = await fetch(`${COINGECKO}/simple/price?ids=${encodeURIComponent(list)}&vs_currencies=rub`);
  if (!r.ok) throw new Error('CoinGecko error ' + r.status);
  const j = await r.json();
  const out = {};
  for (const id of ids) out[id] = j[id] ? Number(j[id].rub) : null;
  return out;
}

// Поиск монеты по названию/тикеру
async function searchCrypto(q) {
  const r = await fetch(`${COINGECKO}/search?query=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('CoinGecko error ' + r.status);
  const j = await r.json();
  return (j.coins || []).slice(0, 10).map(c => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, thumb: c.thumb,
  }));
}

// Цена акции в RUB (Finnhub, если задан ключ). Возвращает { priceRub, priceUsd, usdRub } или null
async function fetchStockPriceRub(symbol) {
  if (!STOCK_API_KEY || !symbol) return null;
  const r = await fetch(`${FINNHUB}/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${STOCK_API_KEY}`);
  if (!r.ok) throw new Error('Finnhub error ' + r.status);
  const j = await r.json();
  const priceUsd = Number(j.c);
  if (!priceUsd) return null;
  const usdRub = await getUsdRub();
  return { priceUsd, usdRub, priceRub: priceUsd * usdRub };
}

// ──────────────────── ROUTES ────────────────────
router.get('/config', (req, res) => {
  res.json({ crypto: true, stocks: Boolean(STOCK_API_KEY) });
});

router.get('/crypto/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    res.json(await searchCrypto(q));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/crypto/price', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    res.json(await fetchCryptoPrices(ids));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/stock', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const data = await fetchStockPriceRub(symbol);
    if (!data) return res.status(503).json({ error: 'Котировки акций недоступны (нет STOCK_API_KEY)' });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = {
  router,
  getUsdRub,
  fetchCryptoPrices,
  searchCrypto,
  fetchStockPriceRub,
  hasStockApi: () => Boolean(STOCK_API_KEY),
};
