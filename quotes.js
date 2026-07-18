// ===================================================================
// FinanceBot — quotes.js
// Котировки активов:
//   • Криптовалюта — CoinGecko (без ключа)
//   • Российские акции — MOEX ISS (без ключа, цена сразу в RUB)
//   • Зарубежные акции — Finnhub (опционально по ключу STOCK_API_KEY)
// Всё приводится к RUB. Комбинированный источник: сначала MOEX, затем Finnhub.
// ===================================================================
const express = require('express');
const router = express.Router();

const COINGECKO = 'https://api.coingecko.com/api/v3';
const FINNHUB = 'https://finnhub.io/api/v1';
const MOEX = 'https://iss.moex.com/iss';
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

// ──────────────────── АКЦИИ ────────────────────

// Разобрать ответ MOEX ISS ({columns, data}) в массив объектов
function moexRows(block) {
  if (!block || !Array.isArray(block.columns) || !Array.isArray(block.data)) return [];
  return block.data.map(row => {
    const obj = {};
    block.columns.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
}

// Цена российской акции в RUB через MOEX ISS (без ключа).
// Возвращает { priceRub, source:'moex', board } или null.
async function fetchMoexPriceRub(symbol) {
  if (!symbol) return null;
  const sec = encodeURIComponent(symbol.toUpperCase());
  const url = `${MOEX}/engines/stock/markets/shares/boards/TQBR/securities/${sec}.json`
    + `?iss.meta=off&iss.only=securities,marketdata`
    + `&securities.columns=SECID,PREVPRICE,SHORTNAME`
    + `&marketdata.columns=SECID,LAST,MARKETPRICE`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('MOEX error ' + r.status);
  const j = await r.json();
  const md = moexRows(j.marketdata)[0] || {};
  const sc = moexRows(j.securities)[0] || {};
  // Приоритет: последняя сделка → рыночная цена → цена закрытия пред. дня
  const price = Number(md.LAST) || Number(md.MARKETPRICE) || Number(sc.PREVPRICE) || 0;
  if (!price) return null;
  return { priceRub: price, source: 'moex', board: 'TQBR', name: sc.SHORTNAME || symbol.toUpperCase() };
}

// Цена зарубежной акции в RUB через Finnhub (нужен ключ).
// Возвращает { priceRub, priceUsd, usdRub, source:'finnhub' } или null.
async function fetchFinnhubPriceRub(symbol) {
  if (!STOCK_API_KEY || !symbol) return null;
  const r = await fetch(`${FINNHUB}/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${STOCK_API_KEY}`);
  if (!r.ok) throw new Error('Finnhub error ' + r.status);
  const j = await r.json();
  const priceUsd = Number(j.c);
  if (!priceUsd) return null;
  const usdRub = await getUsdRub();
  return { priceUsd, usdRub, priceRub: priceUsd * usdRub, source: 'finnhub' };
}

// Комбинированная котировка акции в RUB.
// Сначала пробуем MOEX (российские бумаги), затем Finnhub (зарубежные).
// Возвращает { priceRub, source, ... } или null.
async function fetchStockPriceRub(symbol) {
  if (!symbol) return null;
  // 1) MOEX — без ключа, цена сразу в рублях
  try {
    const moex = await fetchMoexPriceRub(symbol);
    if (moex && moex.priceRub) return moex;
  } catch (_) { /* пробуем Finnhub */ }
  // 2) Finnhub — если задан ключ
  try {
    const fh = await fetchFinnhubPriceRub(symbol);
    if (fh && fh.priceRub) return fh;
  } catch (_) { /* ничего не нашли */ }
  return null;
}

// Поиск акций на MOEX по названию/тикеру (без ключа)
async function searchStock(q) {
  if (!q) return [];
  const url = `${MOEX}/securities.json?q=${encodeURIComponent(q)}&iss.meta=off`
    + `&securities.columns=secid,shortname,is_traded,type,primary_boardid&limit=20`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('MOEX error ' + r.status);
  const j = await r.json();
  return moexRows(j.securities)
    // только реально торгуемые обыкновенные/привилегированные акции на основном режиме
    .filter(s => s.is_traded && s.primary_boardid === 'TQBR'
      && (s.type === 'common_share' || s.type === 'preferred_share'))
    .slice(0, 10)
    .map(s => ({ symbol: s.secid, name: s.shortname, source: 'moex' }));
}

// ──────────────────── ROUTES ────────────────────
router.get('/config', (req, res) => {
  // Российские акции (MOEX) доступны всегда без ключа;
  // зарубежные (Finnhub) — только при заданном STOCK_API_KEY.
  res.json({ crypto: true, stocks: true, stocksRu: true, stocksIntl: Boolean(STOCK_API_KEY) });
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

// Поиск акций (MOEX)
router.get('/stock/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    res.json(await searchStock(q));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/stock', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const data = await fetchStockPriceRub(symbol);
    if (!data) return res.status(404).json({ error: 'Котировка не найдена (проверьте тикер; зарубежные акции требуют STOCK_API_KEY)' });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = {
  router,
  getUsdRub,
  fetchCryptoPrices,
  searchCrypto,
  searchStock,
  fetchStockPriceRub,
  fetchMoexPriceRub,
  fetchFinnhubPriceRub,
  hasStockApi: () => true, // MOEX доступен всегда
};
