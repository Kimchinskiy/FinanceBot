/* ===================================================================
   FinanceBot — app.js (Postgres backend)
   Full logic: state, rendering, charts, modals, API persistence
=================================================================== */

const API = '/api';
const AUTH_KEY = 'fb_token';
const USER_KEY = 'fb_user';

function getToken() { return localStorage.getItem(AUTH_KEY); }
function setSession(token, user) {
  localStorage.setItem(AUTH_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
}
function logout() {
  clearSession();
  location.reload();
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) { logout(); throw new Error('auth'); }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ──────────────────── STATE ──────────────────── */
const DEFAULT_INCOME_CATS  = ['Зарплата','Фриланс','Подработка','Подарок','Инвестиции','Прочее'];
const DEFAULT_EXPENSE_CATS = ['Еда','Транспорт','Жильё','Одежда','Здоровье','Развлечения','Связь','Коммуналка','Кредит','Прочее'];

let state = {
  incomes:    [],
  expenses:   [],
  mandatory:  [],
  accounts:   [],
  cash:       0,
  salary:     { day: null, amount: 0, period: 'monthly' },
  incomeCategories:  [...DEFAULT_INCOME_CATS],
  expenseCategories: [...DEFAULT_EXPENSE_CATS],
};

const SPENDABLE_TYPES = ['cash', 'card'];
const INVEST_TYPES = ['deposit', 'crypto', 'broker'];

/* ──────────────────── LOAD FROM API ──────────────────── */
async function loadAll() {
  try {
    const [incomes, expenses, mandatory, settings, accounts] = await Promise.all([
      api('GET', '/incomes'),
      api('GET', '/expenses'),
      api('GET', '/mandatory'),
      api('GET', '/settings'),
      api('GET', '/accounts'),
    ]);
    state.incomes = incomes;
    state.expenses = expenses;
    state.accounts = accounts || [];
    state.mandatory = mandatory.map(m => ({
      ...m,
      amount: parseFloat(m.amount),
    }));
    state.cash = parseFloat(settings.cash || 0);
    if (settings.salary) {
      state.salary = typeof settings.salary === 'string' ? JSON.parse(settings.salary) : settings.salary;
    }
    if (settings.income_categories) {
      const cats = typeof settings.income_categories === 'string'
        ? JSON.parse(settings.income_categories)
        : settings.income_categories;
      state.incomeCategories = cats.length ? cats : DEFAULT_INCOME_CATS;
    }
    if (settings.expense_categories) {
      const cats = typeof settings.expense_categories === 'string'
        ? JSON.parse(settings.expense_categories)
        : settings.expense_categories;
      state.expenseCategories = cats.length ? cats : DEFAULT_EXPENSE_CATS;
    }
  } catch (e) {
    console.error('Load error', e);
  }
}

/* ──────────────────── HELPERS ──────────────────── */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function fmt(n, sign=false) {
  const abs = Math.abs(Number(n)).toLocaleString('ru-RU', {maximumFractionDigits: 2});
  if (sign) return (n >= 0 ? '+' : '−') + abs + ' ₽';
  return abs + ' ₽';
}

function fmtDate(dt) {
  return new Date(dt).toLocaleDateString('ru-RU', {day:'numeric', month:'short', year:'numeric'});
}
function fmtDateTime(dt) {
  return new Date(dt).toLocaleString('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
}

function now() {
  return new Date().toISOString().slice(0,16);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function inPeriod(dt, period) {
  const d = new Date(dt);
  const n = new Date();
  if (period === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  if (period === '3month') { const c = new Date(); c.setMonth(c.getMonth()-3); return d >= c; }
  if (period === '6month') { const c = new Date(); c.setMonth(c.getMonth()-6); return d >= c; }
  if (period === 'year')   { const c = new Date(); c.setFullYear(c.getFullYear()-1); return d >= c; }
  return true;
}

function getCategoryColor(name) {
  const colors = ['#0071e3','#34c759','#5ac8fa','#ff9500','#af52de','#ff2d55','#30b0c7','#ffcc00','#ff3b30','#64d2ff'];
  let hash = 0;
  for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function getNextSalaryDate() {
  if (!state.salary.day) return null;
  const today = new Date();
  const day = state.salary.day;
  let next = new Date(today.getFullYear(), today.getMonth(), day);
  if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, day);
  return next;
}

function daysUntilSalary() {
  const next = getNextSalaryDate();
  if (!next) return null;
  return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24));
}

/* ──────────────────── ACCOUNTS / ASSETS HELPERS ──────────────────── */
function accountsByType(type) {
  return state.accounts.filter(a => a.type === type);
}
function sumBalances(types) {
  return state.accounts
    .filter(a => types.includes(a.type))
    .reduce((s, a) => s + (Number(a.balance) || 0), 0);
}
function spendableTotal() { return sumBalances(SPENDABLE_TYPES); }
function investTotal()    { return sumBalances(INVEST_TYPES); }
function netWorth()       { return spendableTotal() + investTotal(); }

function findAccountByName(name) {
  return state.accounts.find(a => a.name === name);
}
const ASSET_TYPE_LABEL = { deposit: 'Вклад', crypto: 'Криптовалюта', broker: 'Акция' };

// Создать/обновить простой счёт (Наличные/Карта) с заданным балансом
async function saveAccountBalance(name, type, balance) {
  const acc = findAccountByName(name);
  if (acc) {
    await api('PUT', `/accounts/${acc.id}`, { name, type, currency: 'RUB', balance });
  } else {
    await api('POST', '/accounts', { name, type, currency: 'RUB', balance });
  }
}

let activePage = 'dashboard';
let editingId = null;
let editingType = null;

/* ──────────────────── NAVIGATION ──────────────────── */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');
  activePage = page;
  const titles = {
    dashboard: 'Обзор', income: 'Доходы', expenses: 'Расходы',
    mandatory: 'Обязательные платежи', assets: 'Активы', analytics: 'Аналитика', settings: 'Настройки'
  };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

let chartInstances = {};

function renderPage(page) {
  if (page === 'dashboard')  renderDashboard();
  if (page === 'income')     renderIncomeTable();
  if (page === 'expenses')   renderExpenseTable();
  if (page === 'mandatory')  renderMandatoryCards();
  if (page === 'assets')     renderAssets();
  if (page === 'analytics')  renderAnalytics();
  if (page === 'settings')   renderSettings();
}

/* ──────────────────── DASHBOARD ──────────────────── */
function renderDashboard() {
  const month = currentMonth();
  const thisIncome  = state.incomes.filter(i => i.datetime.startsWith(month));
  const thisExpense = state.expenses.filter(e => e.datetime.startsWith(month));
  const totalIncome  = thisIncome.reduce((s,i) => s + Number(i.amount), 0);
  const totalExpense = thisExpense.reduce((s,e) => s + Number(e.amount), 0);

  const cashBal = findAccountByName('Наличные')?.balance || 0;
  const cardBal = findAccountByName('Карта')?.balance || 0;
  const spendable = spendableTotal();
  const invest = investTotal();
  const net = spendable + invest;

  document.getElementById('available-total').textContent = fmt(spendable);
  document.getElementById('available-breakdown').textContent =
    `Наличные ${fmt(cashBal)} · Карта ${fmt(cardBal)}`;
  document.getElementById('assets-total').textContent = fmt(invest);

  const dep = sumBalances(['deposit']), cr = sumBalances(['crypto']), br = sumBalances(['broker']);
  const parts = [];
  if (dep) parts.push(`Вклады ${fmt(dep)}`);
  if (cr)  parts.push(`Крипта ${fmt(cr)}`);
  if (br)  parts.push(`Акции ${fmt(br)}`);
  document.getElementById('assets-breakdown').textContent = parts.length ? parts.join(' · ') : 'Вклады · Крипта · Акции';

  document.getElementById('networth-total').textContent = fmt(net);
  document.getElementById('monthly-income').textContent = fmt(totalIncome);
  document.getElementById('monthly-expense').textContent = fmt(totalExpense);
  document.getElementById('income-count').textContent = `${thisIncome.length} операций`;
  document.getElementById('expense-count').textContent = `${thisExpense.length} операций`;

  renderSalaryBar();
  renderRecentTransactions();
  renderDashboardMandatory();
}

function renderSalaryBar() {
  const bar = document.getElementById('salary-bar');
  if (!state.salary.day) { bar.style.display = 'none'; return; }
  const next = getNextSalaryDate();
  const days = daysUntilSalary();
  bar.style.display = 'flex';
  document.getElementById('salary-bar-sub').textContent = fmtDate(next);
  document.getElementById('salary-days-chip').textContent = days === 0 ? '🎉 Сегодня!' : `${days} дн.`;
  document.getElementById('salary-expected').textContent = state.salary.amount ? fmt(state.salary.amount) : '';
}

function renderRecentTransactions() {
  const all = [
    ...state.incomes.map(i  => ({ ...i, kind: 'income'  })),
    ...state.expenses.map(e => ({ ...e, kind: 'expense' }))
  ].sort((a,b) => new Date(b.datetime) - new Date(a.datetime)).slice(0, 8);
  const el = document.getElementById('recent-transactions');
  if (!all.length) { el.innerHTML = '<div class="empty-state">Нет операций. Добавьте первую!</div>'; return; }
  el.innerHTML = all.map(t => `
    <div class="tx-item tx-${t.kind}">
      <div class="tx-icon">${t.kind === 'income' ? '📈' : getCategoryEmoji(t.category)}</div>
      <div class="tx-info">
        <div class="tx-name">${t.description || t.category}</div>
        <div class="tx-cat">${t.category} · ${sourceLabel(t.source)}</div>
      </div>
      <div>
        <div class="tx-amount">${t.kind === 'income' ? '+' : '−'}${fmt(t.amount)}</div>
        <div class="tx-date">${fmtDateTime(t.datetime)}</div>
      </div>
    </div>
  `).join('');
}

function renderDashboardMandatory() {
  const el = document.getElementById('dashboard-mandatory');
  const items = state.mandatory.slice(0, 5);
  if (!items.length) { el.innerHTML = '<div class="empty-state">Нет обязательных платежей</div>'; return; }
  el.innerHTML = items.map(m => `
    <div class="m-item">
      <div>
        <div class="m-name">${m.name}</div>
        <div class="m-meta">${m.category} · ${typeLabel(m.type)} · ${m.day || '—'} число</div>
      </div>
      <div class="m-right">
        <div class="m-amount">${fmt(m.amount)}</div>
        <div class="m-status ${m.status}">${m.status === 'paid' ? 'Оплачен' : 'Ожидает'}</div>
      </div>
    </div>
  `).join('');
}

function chartDefaults() {
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#6e6e73', font: { family: '-apple-system, Inter', size: 12 }, boxWidth: 12, padding: 16 } },
      tooltip: {
        backgroundColor: '#1d1d1f', borderColor: 'rgba(0,0,0,0.06)', borderWidth: 1,
        titleColor: '#ffffff', bodyColor: '#d1d1d6', padding: 12, cornerRadius: 10, displayColors: false,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('ru-RU')} ₽` }
      }
    },
    scales: {
      x: { ticks: { color: '#86868b', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(0,0,0,0.05)' } },
      y: { ticks: { color: '#86868b', font: { size: 10 }, callback: v => v.toLocaleString('ru-RU') }, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };
}

/* ──────────────────── INCOME TABLE ──────────────────── */
function renderIncomeTable() {
  populateMonthFilter('income-filter-month', state.incomes);
  populateCategoryFilter('income-filter-cat', state.incomeCategories);
  renderIncomeRows();
}

function renderIncomeRows() {
  const month = document.getElementById('income-filter-month').value;
  const cat   = document.getElementById('income-filter-cat').value;
  let data = [...state.incomes].sort((a,b) => new Date(b.datetime) - new Date(a.datetime));
  if (month) data = data.filter(i => i.datetime.startsWith(month));
  if (cat)   data = data.filter(i => i.category === cat);
  const tbody = document.getElementById('income-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Нет доходов</td></tr>'; return; }
  tbody.innerHTML = data.map(i => `
    <tr>
      <td>${fmtDateTime(i.datetime)}</td>
      <td><span class="cat-badge" style="background:${getCategoryColor(i.category)}22;color:${getCategoryColor(i.category)}">${i.category}</span></td>
      <td><span class="src-badge">${sourceLabel(i.source)}</span></td>
      <td>${i.description || '—'}</td>
      <td class="amount-income">+${fmt(i.amount)}</td>
      <td><button class="action-btn" onclick="deleteRecord('income','${i.id}')" title="Удалить">🗑</button></td>
    </tr>
  `).join('');
}

/* ──────────────────── EXPENSE TABLE ──────────────────── */
function renderExpenseTable() {
  populateMonthFilter('expense-filter-month', state.expenses);
  populateCategoryFilter('expense-filter-cat', state.expenseCategories);
  renderExpenseRows();
}

function renderExpenseRows() {
  const month = document.getElementById('expense-filter-month').value;
  const cat   = document.getElementById('expense-filter-cat').value;
  let data = [...state.expenses].sort((a,b) => new Date(b.datetime) - new Date(a.datetime));
  if (month) data = data.filter(e => e.datetime.startsWith(month));
  if (cat)   data = data.filter(e => e.category === cat);
  const tbody = document.getElementById('expense-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Нет расходов</td></tr>'; return; }
  tbody.innerHTML = data.map(e => `
    <tr>
      <td>${fmtDateTime(e.datetime)}</td>
      <td><span class="cat-badge" style="background:${getCategoryColor(e.category)}22;color:${getCategoryColor(e.category)}">${e.category}</span></td>
      <td><span class="src-badge">${sourceLabel(e.source)}</span></td>
      <td>${e.description || '—'}</td>
      <td class="amount-expense">−${fmt(e.amount)}</td>
      <td><button class="action-btn" onclick="deleteRecord('expense','${e.id}')" title="Удалить">🗑</button></td>
    </tr>
  `).join('');
}

function populateMonthFilter(elId, data) {
  const el = document.getElementById(elId);
  const cur = el.value;
  const months = [...new Set(data.map(d => d.datetime.slice(0,7)))].sort().reverse();
  el.innerHTML = '<option value="">Все месяцы</option>' + months.map(m => {
    const [y,mo] = m.split('-');
    const label = new Date(y, mo-1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
    return `<option value="${m}" ${m===cur?'selected':''}>${label}</option>`;
  }).join('');
}

function populateCategoryFilter(elId, cats) {
  const el = document.getElementById(elId);
  const cur = el.value;
  el.innerHTML = '<option value="">Все категории</option>' + cats.map(c =>
    `<option value="${c}" ${c===cur?'selected':''}>${c}</option>`
  ).join('');
}

/* ──────────────────── MANDATORY CARDS ──────────────────── */
function renderMandatoryCards() {
  const el = document.getElementById('mandatory-cards');
  const items = state.mandatory;
  if (!items.length) { el.innerHTML = '<div class="empty-state">Нет обязательных платежей. Добавьте первый!</div>'; return; }
  el.innerHTML = items.map(m => `
    <div class="mandatory-card ${m.status === 'paid' ? 'paid-card' : ''}">
      <div class="mc-header">
        <div class="mc-name">${m.name}</div>
        <div class="mc-actions"><button class="action-btn" onclick="deleteMandatory('${m.id}')" title="Удалить">🗑</button></div>
      </div>
      <div class="mc-amount">${fmt(m.amount)}</div>
      <div class="mc-meta">
        <span class="mc-chip">${m.category}</span>
        <span class="mc-chip">${typeLabel(m.type)}</span>
        ${m.day ? `<span class="mc-chip">${m.day} числа</span>` : ''}
      </div>
      <button class="mc-status-btn ${m.status === 'paid' ? 'mark-unpaid' : 'mark-paid'}"
        onclick="toggleMandatoryStatus('${m.id}')">
        ${m.status === 'paid' ? '↩ Отметить неоплаченным' : '✓ Отметить оплаченным'}
      </button>
    </div>
  `).join('');
}

function typeLabel(t) {
  return { monthly: 'Ежемесячно', once: 'Разово', yearly: 'Ежегодно' }[t] || t;
}

/* ──────────────────── ASSETS PAGE ──────────────────── */
let quotesConfig = { crypto: true, stocks: false };

function renderAssets() {
  const dep = sumBalances(['deposit']);
  const cr  = sumBalances(['crypto']);
  const br  = sumBalances(['broker']);
  document.getElementById('assets-page-total').textContent = fmt(dep + cr + br);
  document.getElementById('assets-deposits').textContent = fmt(dep);
  document.getElementById('assets-crypto').textContent = fmt(cr);
  document.getElementById('assets-stocks').textContent = fmt(br);

  renderAssetList('deposit');
  renderAssetList('crypto');
  renderAssetList('broker');

  // Время последнего обновления котировок
  const invest = state.accounts.filter(a => (a.type === 'crypto' || a.type === 'broker') && a.price_updated_at);
  const upd = document.getElementById('assets-updated');
  if (upd) {
    if (invest.length) {
      const latest = invest.map(a => new Date(a.price_updated_at)).sort((a,b) => b - a)[0];
      upd.textContent = 'Котировки: ' + fmtDateTime(latest);
    } else upd.textContent = '';
  }
}

function renderAssetList(type) {
  const el = document.getElementById(`asset-list-${type}`);
  if (!el) return;
  const items = accountsByType(type);
  if (!items.length) {
    const empty = { deposit: 'Нет вкладов', crypto: 'Нет криптовалюты', broker: 'Нет акций' }[type];
    el.innerHTML = `<div class="empty-state">${empty}</div>`;
    return;
  }
  el.innerHTML = items.map(a => {
    let sub = '';
    if (type === 'crypto') {
      sub = `${(a.quantity ?? 0)} ${(a.symbol || '').toUpperCase()} × ${fmt(a.unit_price || 0)}`;
    } else if (type === 'broker') {
      sub = `${(a.quantity ?? 0)} × ${fmt(a.unit_price || 0)} · ${(a.symbol || '').toUpperCase()}`;
    } else {
      const rate = a.meta && a.meta.rate ? ` · ${a.meta.rate}% годовых` : '';
      sub = `${a.currency || 'RUB'}${rate}`;
    }
    return `
      <div class="asset-item">
        <div class="asset-icon">${assetEmoji(type)}</div>
        <div class="asset-info">
          <div class="asset-name">${a.name}</div>
          <div class="asset-sub">${sub}</div>
        </div>
        <div class="asset-right">
          <div class="asset-value">${fmt(a.balance)}</div>
          <div class="asset-actions">
            <button class="action-btn" onclick="openAssetModal('${type}','${a.id}')" title="Изменить">✎</button>
            <button class="action-btn" onclick="deleteAsset('${a.id}')" title="Удалить">🗑</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function assetEmoji(type) {
  return { deposit: '🏦', crypto: '₿', broker: '📊' }[type] || '💰';
}

/* ── Asset modal ── */
let editingAssetId = null;
let selectedCrypto = null;   // { id, symbol, name }
let cryptoSearchTimer = null;

function openAssetModal(type = 'deposit', id = null) {
  editingAssetId = id;
  selectedCrypto = null;
  const asset = id ? state.accounts.find(a => a.id === id) : null;
  document.getElementById('asset-modal-title').textContent = asset ? 'Изменить актив' : 'Добавить актив';
  document.getElementById('asset-type').value = asset ? asset.type : type;

  // reset fields
  document.getElementById('asset-name').value = asset ? asset.name : '';
  document.getElementById('asset-balance').value = asset && asset.type === 'deposit' ? asset.balance : '';
  document.getElementById('asset-rate').value = asset && asset.meta && asset.meta.rate ? asset.meta.rate : '';
  document.getElementById('asset-crypto-search').value = '';
  document.getElementById('crypto-results').innerHTML = '';
  document.getElementById('asset-qty-crypto').value = asset && asset.type === 'crypto' ? asset.quantity : '';
  document.getElementById('asset-symbol-broker').value = asset && asset.type === 'broker' ? (asset.symbol || '') : '';
  document.getElementById('asset-qty-broker').value = asset && asset.type === 'broker' ? asset.quantity : '';
  document.getElementById('asset-price-broker').value = asset && asset.type === 'broker' ? asset.unit_price : '';
  document.getElementById('crypto-preview').innerHTML = '';
  document.getElementById('broker-preview').innerHTML = '';

  if (asset && asset.type === 'crypto') {
    selectedCrypto = { id: asset.symbol, symbol: asset.symbol, name: asset.name };
    document.getElementById('crypto-selected').innerHTML = `Выбрано: <b>${asset.name}</b>`;
  } else {
    document.getElementById('crypto-selected').innerHTML = '';
  }

  document.getElementById('broker-hint').textContent = quotesConfig.stocks
    ? 'Можно получить котировку автоматически' : 'Авто-котировки выкл. — введите цену вручную (в .env: STOCK_API_KEY)';
  document.getElementById('fetch-stock-btn').style.display = quotesConfig.stocks ? '' : 'none';

  switchAssetType(document.getElementById('asset-type').value);
  document.getElementById('asset-modal').style.display = 'flex';
}

function closeAssetModal() { document.getElementById('asset-modal').style.display = 'none'; }

function switchAssetType(type) {
  document.querySelectorAll('[data-asset-fields]').forEach(el => {
    el.style.display = el.dataset.assetFields === type ? '' : 'none';
  });
}

async function searchCryptoInput() {
  const q = document.getElementById('asset-crypto-search').value.trim();
  const box = document.getElementById('crypto-results');
  if (!q) { box.innerHTML = ''; return; }
  clearTimeout(cryptoSearchTimer);
  cryptoSearchTimer = setTimeout(async () => {
    try {
      const results = await api('GET', `/quotes/crypto/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = results.map(c =>
        `<div class="crypto-result" onclick='pickCrypto(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
           <span class="cr-name">${c.name}</span>
           <span class="cr-sym">${c.symbol}</span>
         </div>`
      ).join('') || '<div class="crypto-result muted">Ничего не найдено</div>';
    } catch (e) {
      box.innerHTML = '<div class="crypto-result muted">Ошибка поиска</div>';
    }
  }, 350);
}

function pickCrypto(c) {
  selectedCrypto = { id: c.id, symbol: c.symbol, name: c.name };
  document.getElementById('crypto-selected').innerHTML = `Выбрано: <b>${c.name}</b> (${c.symbol})`;
  document.getElementById('crypto-results').innerHTML = '';
  document.getElementById('asset-crypto-search').value = c.name;
  updateCryptoPreview();
}

async function updateCryptoPreview() {
  const qty = parseFloat(document.getElementById('asset-qty-crypto').value);
  const prev = document.getElementById('crypto-preview');
  if (!selectedCrypto || !qty) { prev.innerHTML = ''; return; }
  prev.innerHTML = 'Загрузка цены…';
  try {
    const prices = await api('GET', `/quotes/crypto/price?ids=${encodeURIComponent(selectedCrypto.id)}`);
    const price = prices[selectedCrypto.id];
    if (price) {
      prev.innerHTML = `Цена: <b>${fmt(price)}</b> · Стоимость: <b>${fmt(price * qty)}</b>`;
      prev.dataset.price = price;
    } else { prev.innerHTML = 'Цена недоступна'; }
  } catch (e) { prev.innerHTML = 'Не удалось получить цену'; }
}

async function fetchStockQuote() {
  const symbol = document.getElementById('asset-symbol-broker').value.trim();
  const hint = document.getElementById('broker-hint');
  if (!symbol) { shakeField('asset-symbol-broker'); return; }
  hint.textContent = 'Загрузка котировки…';
  try {
    const data = await api('GET', `/quotes/stock?symbol=${encodeURIComponent(symbol)}`);
    if (data && data.priceRub) {
      document.getElementById('asset-price-broker').value = data.priceRub.toFixed(2);
      hint.textContent = `Котировка: ${fmt(data.priceUsd)} USD × ${data.usdRub.toFixed(2)} = ${fmt(data.priceRub)}`;
      updateBrokerPreview();
    } else { hint.textContent = 'Котировка недоступна'; }
  } catch (e) { hint.textContent = 'Ошибка получения котировки'; }
}

function updateBrokerPreview() {
  const qty = parseFloat(document.getElementById('asset-qty-broker').value);
  const price = parseFloat(document.getElementById('asset-price-broker').value);
  const prev = document.getElementById('broker-preview');
  if (qty && price) prev.innerHTML = `Стоимость: <b>${fmt(qty * price)}</b>`;
  else prev.innerHTML = '';
}

async function saveAsset() {
  const type = document.getElementById('asset-type').value;
  let payload = { type, currency: 'RUB' };

  if (type === 'deposit') {
    const name = document.getElementById('asset-name').value.trim();
    const balance = parseFloat(document.getElementById('asset-balance').value);
    const rate = parseFloat(document.getElementById('asset-rate').value);
    if (!name) { shakeField('asset-name'); return; }
    if (isNaN(balance)) { shakeField('asset-balance'); return; }
    payload.name = name;
    payload.balance = balance;
    payload.meta = { rate: isNaN(rate) ? null : rate };
  } else if (type === 'crypto') {
    const qty = parseFloat(document.getElementById('asset-qty-crypto').value);
    if (!selectedCrypto) { shakeField('asset-crypto-search'); return; }
    if (!qty || qty <= 0) { shakeField('asset-qty-crypto'); return; }
    let price = parseFloat(document.getElementById('crypto-preview').dataset.price || '0');
    try {
      if (!price) {
        const prices = await api('GET', `/quotes/crypto/price?ids=${encodeURIComponent(selectedCrypto.id)}`);
        price = prices[selectedCrypto.id] || 0;
      }
    } catch (_) {}
    payload.name = selectedCrypto.name;
    payload.symbol = selectedCrypto.id;
    payload.quantity = qty;
    payload.unit_price = price;
  } else if (type === 'broker') {
    const symbol = document.getElementById('asset-symbol-broker').value.trim();
    const qty = parseFloat(document.getElementById('asset-qty-broker').value);
    const price = parseFloat(document.getElementById('asset-price-broker').value);
    if (!symbol) { shakeField('asset-symbol-broker'); return; }
    if (!qty || qty <= 0) { shakeField('asset-qty-broker'); return; }
    if (isNaN(price) || price <= 0) { shakeField('asset-price-broker'); return; }
    payload.name = symbol.toUpperCase();
    payload.symbol = symbol.toUpperCase();
    payload.quantity = qty;
    payload.unit_price = price;
  }

  try {
    if (editingAssetId) await api('PUT', `/accounts/${editingAssetId}`, payload);
    else await api('POST', '/accounts', payload);
    state.accounts = await api('GET', '/accounts');
    closeAssetModal();
    renderPage(activePage);
    showToast('Актив сохранён!');
  } catch (e) {
    showToast('Ошибка сохранения', '#ff3b30');
  }
}

function deleteAsset(id) {
  openConfirm('Удалить актив?', async () => {
    try {
      await api('DELETE', `/accounts/${id}`);
      state.accounts = await api('GET', '/accounts');
      renderPage(activePage);
      showToast('Удалено');
    } catch (e) { showToast('Ошибка удаления', '#ff3b30'); }
  });
}

async function refreshPrices() {
  const btn = document.getElementById('refresh-prices-btn');
  const orig = btn.textContent;
  btn.textContent = '⏳ Обновляю…';
  btn.disabled = true;
  try {
    const res = await api('POST', '/accounts/refresh-prices');
    state.accounts = res.accounts || await api('GET', '/accounts');
    renderPage(activePage);
    if (res.errors && res.errors.length) showToast(`Обновлено: ${res.updated}. Ошибки: ${res.errors.length}`, '#ff9500');
    else showToast(`Котировки обновлены (${res.updated})`);
  } catch (e) {
    showToast('Ошибка обновления котировок', '#ff3b30');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

/* ──────────────────── ANALYTICS ──────────────────── */
function renderAnalytics() {
  const period = document.getElementById('analytics-period').value;
  const incomes  = state.incomes.filter(i => inPeriod(i.datetime, period));
  const expenses = state.expenses.filter(e => inPeriod(e.datetime, period));
  const mandSum  = state.mandatory.reduce((s,m) => s + Number(m.amount), 0);
  const totalInc = incomes.reduce((s,i)  => s + Number(i.amount), 0);
  const totalExp = expenses.reduce((s,e) => s + Number(e.amount), 0);
  const profit   = totalInc - totalExp;
  document.getElementById('an-income').textContent  = fmt(totalInc);
  document.getElementById('an-expense').textContent = fmt(totalExp);
  document.getElementById('an-mandatory').textContent = fmt(mandSum);
  const profEl = document.getElementById('an-profit');
  profEl.textContent = fmt(profit, true);
  profEl.className = `acard-val ${profit >= 0 ? 'green' : 'red'}`;
  renderPieChart('expensePieChart', groupBy(expenses, 'category'), 'Расходы');
  renderPieChart('incomePieChart',  groupBy(incomes, 'category'),  'Доходы');
  renderBalanceChart();
  renderMonthlyBarChart();
}

function groupBy(arr, key) {
  const result = {};
  arr.forEach(item => { const k = item[key] || 'Прочее'; result[k] = (result[k] || 0) + Number(item.amount); });
  return result;
}

function renderPieChart(id, data, title) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (chartInstances[id]) chartInstances[id].destroy();
  const labels = Object.keys(data);
  const values = Object.values(data);
  const colors = labels.map(l => getCategoryColor(l));
  chartInstances[id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3, hoverBorderWidth: 3, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#6e6e73', font: { family: '-apple-system, Inter', size: 12 }, padding: 14, boxWidth: 12 } },
        tooltip: { backgroundColor: '#1d1d1f', borderColor: 'rgba(0,0,0,0.06)', borderWidth: 1, titleColor: '#ffffff', bodyColor: '#d1d1d6', padding: 12, cornerRadius: 10, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('ru-RU')} ₽` } }
      },
      cutout: '68%'
    }
  });
}

function renderBalanceChart() {
  const ctx = document.getElementById('balanceChart');
  if (!ctx) return;
  if (chartInstances['balanceChart']) chartInstances['balanceChart'].destroy();
  const allTx = [
    ...state.incomes.map(i  => ({ date: i.datetime, amount: +i.amount })),
    ...state.expenses.map(e => ({ date: e.datetime, amount: -e.amount }))
  ].sort((a,b) => new Date(a.date) - new Date(b.date));
  // Стартовый баланс так, чтобы итог совпал с текущими доступными деньгами
  const netTx = allTx.reduce((s, t) => s + t.amount, 0);
  let running = spendableTotal() - netTx;
  const labels = []; const data = [];
  if (allTx.length) {
    const first = new Date(allTx[0].date);
    labels.push(fmtDate(first)); data.push(running);
    allTx.forEach(tx => { running += tx.amount; labels.push(fmtDate(tx.date)); data.push(running); });
  } else { labels.push('Сейчас'); data.push(running); }
  const positiveColor = '#34c759'; const negativeColor = '#ff3b30';
  chartInstances['balanceChart'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Баланс', data, borderColor: positiveColor, backgroundColor: 'rgba(34,197,94,0.08)',
        fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2,
        segment: {
          borderColor: ctx => ctx.p1.parsed.y < 0 ? negativeColor : positiveColor,
          backgroundColor: ctx => ctx.p1.parsed.y < 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
        }
      }]
    },
    options: chartDefaults()
  });
}

function renderMonthlyBarChart() {
  const ctx = document.getElementById('monthlyBarChart');
  if (!ctx) return;
  if (chartInstances['monthlyBarChart']) chartInstances['monthlyBarChart'].destroy();
  const months = []; const labels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0,7));
    labels.push(d.toLocaleDateString('ru-RU', {month:'short', year:'numeric'}));
  }
  const incData = months.map(m => state.incomes.filter(i => i.datetime.startsWith(m)).reduce((s,i) => s + +i.amount, 0));
  const expData = months.map(m => state.expenses.filter(e => e.datetime.startsWith(m)).reduce((s,e) => s + +e.amount, 0));
  chartInstances['monthlyBarChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Доходы', data: incData, backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6, borderSkipped: false },
        { label: 'Расходы', data: expData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: { ...chartDefaults(), scales: { ...chartDefaults().scales, x: { ...chartDefaults().scales.x, stacked: false }, y: { ...chartDefaults().scales.y, stacked: false } } }
  });
}

/* ──────────────────── SETTINGS ──────────────────── */
function renderSettings() {
  const cashBal = findAccountByName('Наличные')?.balance ?? '';
  const cardBal = findAccountByName('Карта')?.balance ?? '';
  document.getElementById('cash-input').value = cashBal === 0 ? 0 : (cashBal || '');
  const cardEl = document.getElementById('card-input');
  if (cardEl) cardEl.value = cardBal === 0 ? 0 : (cardBal || '');
  document.getElementById('salary-day-input').value = state.salary.day || '';
  document.getElementById('salary-amount-input').value = state.salary.amount || '';
  document.getElementById('salary-period-input').value = state.salary.period || 'monthly';
  renderCategoryChips('income-categories',  state.incomeCategories,  'income');
  renderCategoryChips('expense-categories', state.expenseCategories, 'expense');
}

function renderCategoryChips(elId, cats, type) {
  const el = document.getElementById(elId);
  el.innerHTML = cats.map(c => `
    <div class="category-chip">
      <span>${c}</span>
      <button class="chip-remove" onclick="removeCategory('${type}','${c}')">✕</button>
    </div>
  `).join('');
}

/* ──────────────────── CATEGORY EMOJI ──────────────────── */
function getCategoryEmoji(cat) {
  const map = {
    'Еда':'🍕','Транспорт':'🚗','Жильё':'🏠','Одежда':'👗','Здоровье':'💊',
    'Развлечения':'🎮','Связь':'📱','Коммуналка':'💡','Кредит':'🏦','Прочее':'📦',
    'Зарплата':'💼','Фриланс':'💻','Подработка':'🔧','Подарок':'🎁','Инвестиции':'📊'
  };
  return map[cat] || '💰';
}

/* ──────────────────── SOURCE (счёт) ──────────────────── */
function sourceLabel(src) {
  const s = src || 'Наличные';
  const emoji = { 'Наличные': '💵', 'Карта': '💳' }[s] || '💰';
  return `${emoji} ${s}`;
}

/* ──────────────────── MODALS ──────────────────── */
let modalType = 'expense';

function openQuickAdd(type = 'expense') {
  modalType = type;
  editingId = null;
  document.getElementById('modal-title').textContent = 'Добавить операцию';
  document.getElementById('modal-amount').value = '';
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-date').value = now();
  setSourceToggle('Наличные');
  setModalTab(type);
  document.getElementById('quick-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-amount').focus(), 100);
}

function setModalTab(type) {
  modalType = type;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const cats = type === 'income' ? state.incomeCategories : state.expenseCategories;
  const sel = document.getElementById('modal-category');
  sel.innerHTML = cats.map(c => `<option>${c}</option>`).join('');
}

// Переключатель-рычаг источника: Наличные / Безнал (Карта)
function setSourceToggle(source) {
  document.getElementById('modal-source').value = source;
  const toggle = document.getElementById('modal-source-toggle');
  if (!toggle) return;
  toggle.classList.toggle('is-card', source === 'Карта');
  toggle.querySelectorAll('.source-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.source === source));
}

function closeQuickModal() { document.getElementById('quick-modal').style.display = 'none'; }

async function saveQuickModal() {
  const amount = parseFloat(document.getElementById('modal-amount').value);
  const category = document.getElementById('modal-category').value;
  const description = document.getElementById('modal-desc').value.trim();
  const datetime = document.getElementById('modal-date').value || now();
  const source = document.getElementById('modal-source').value || 'Наличные';
  if (!amount || amount <= 0) { shakeField('modal-amount'); return; }

  try {
    if (modalType === 'income') {
      await api('POST', '/incomes', { amount, category, description, datetime, source });
      state.incomes = await api('GET', '/incomes');
    } else {
      await api('POST', '/expenses', { amount, category, description, datetime, source });
      state.expenses = await api('GET', '/expenses');
    }
    closeQuickModal();
    renderPage(activePage);
    showToast(`${modalType === 'income' ? 'Доход' : 'Расход'} добавлен!`);
  } catch (e) {
    showToast('Ошибка сохранения', '#ff3b30');
  }
}

let editingMandatoryId = null;

function openMandatoryModal() {
  editingMandatoryId = null;
  document.getElementById('mandatory-modal-title').textContent = 'Добавить обязательный платёж';
  document.getElementById('m-name').value = '';
  document.getElementById('m-amount').value = '';
  document.getElementById('m-day').value = '';
  document.getElementById('m-status').value = 'pending';
  document.getElementById('m-type').value = 'monthly';
  const cats = state.expenseCategories;
  document.getElementById('m-category').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
  document.getElementById('mandatory-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('m-name').focus(), 100);
}

function closeMandatoryModal() { document.getElementById('mandatory-modal').style.display = 'none'; }

async function saveMandatoryModal() {
  const name   = document.getElementById('m-name').value.trim();
  const amount = parseFloat(document.getElementById('m-amount').value);
  const category = document.getElementById('m-category').value;
  const day    = parseInt(document.getElementById('m-day').value) || null;
  const type   = document.getElementById('m-type').value;
  const status = document.getElementById('m-status').value;
  if (!name)   { shakeField('m-name'); return; }
  if (!amount || amount <= 0) { shakeField('m-amount'); return; }
  try {
    if (editingMandatoryId) {
      await api('PUT', `/mandatory/${editingMandatoryId}`, { name, amount, category, day, type, status });
    } else {
      await api('POST', '/mandatory', { name, amount, category, day, type, status });
    }
    state.mandatory = await api('GET', '/mandatory');
    closeMandatoryModal();
    renderPage(activePage);
    showToast('Платёж сохранён!');
  } catch (e) {
    showToast('Ошибка сохранения', '#ef4444');
  }
}

let confirmCallback = null;
function openConfirm(text, cb) {
  document.getElementById('confirm-text').textContent = text;
  confirmCallback = cb;
  document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirm() { document.getElementById('confirm-modal').style.display = 'none'; }

/* ──────────────────── ACTIONS ──────────────────── */
function deleteRecord(type, id) {
  openConfirm('Удалить запись?', async () => {
    try {
      await api('DELETE', `/${type}s/${id}`);
      if (type === 'income') state.incomes = await api('GET', '/incomes');
      if (type === 'expense') state.expenses = await api('GET', '/expenses');
      renderPage(activePage); showToast('Удалено');
    } catch (e) { showToast('Ошибка удаления', '#ef4444'); }
  });
}

function deleteMandatory(id) {
  openConfirm('Удалить обязательный платёж?', async () => {
    try {
      await api('DELETE', `/mandatory/${id}`);
      state.mandatory = await api('GET', '/mandatory');
      renderPage(activePage); showToast('Удалено');
    } catch (e) { showToast('Ошибка удаления', '#ef4444'); }
  });
}

async function toggleMandatoryStatus(id) {
  try {
    await api('PATCH', `/mandatory/${id}/toggle`);
    state.mandatory = await api('GET', '/mandatory');
    renderPage(activePage);
  } catch (e) { showToast('Ошибка', '#ef4444'); }
}

async function removeCategory(type, name) {
  try {
    if (type === 'income') {
      state.incomeCategories = state.incomeCategories.filter(c => c !== name);
      await api('PUT', '/settings/income_categories', { value: state.incomeCategories });
    } else {
      state.expenseCategories = state.expenseCategories.filter(c => c !== name);
      await api('PUT', '/settings/expense_categories', { value: state.expenseCategories });
    }
    renderSettings();
  } catch (e) { showToast('Ошибка', '#ef4444'); }
}

/* ──────────────────── TOAST ──────────────────── */
function showToast(msg, color = '#34c759') {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position:'fixed', bottom:'28px', left:'50%', transform:'translateX(-50%) translateY(20px)',
    background: '#1d1d1f', color:'#ffffff', padding:'13px 26px',
    borderRadius:'980px', fontSize:'14px', fontWeight:'500',
    boxShadow:'0 8px 30px rgba(0,0,0,0.18)', zIndex:'9999',
    transition:'all 0.3s cubic-bezier(0.4,0,0.2,1)', opacity:'0'
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

function shakeField(id) {
  const el = document.getElementById(id);
  el.style.borderColor = '#ff3b30';
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = 'shake 0.4s ease'; });
  el.addEventListener('input', () => { el.style.borderColor = ''; el.style.animation = ''; }, { once:true });
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }`;
document.head.appendChild(shakeStyle);

/* ──────────────────── EXPORT (Excel) ──────────────────── */
// TODO: Экспорт в Excel (.xlsx) — фундамент заложен, реализация в разработке.
// Планируется серверный эндпоинт GET /api/export/excel, который соберёт
// доходы/расходы/платежи в книгу .xlsx (напр. через библиотеку exceljs)
// и вернёт файл для скачивания. Кнопка в настройках пока отключена.
function exportExcel() {
  showToast('Экспорт в Excel скоро будет доступен', '#ff9500');
}

/* ──────────────────── AUTH (frontend) ──────────────────── */
let appStarted = false;
let authMode = 'login';

function showAuth() { const s = document.getElementById('auth-screen'); if (s) s.style.display = 'flex'; }
function hideAuth() { const s = document.getElementById('auth-screen'); if (s) s.style.display = 'none'; }

function updateAuthModeUI() {
  const isLogin = authMode === 'login';
  document.getElementById('auth-submit').textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
  document.getElementById('auth-switch-text').textContent = isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?';
  document.getElementById('auth-switch-btn').textContent = isLogin ? 'Зарегистрироваться' : 'Войти';
  document.getElementById('auth-error').textContent = '';
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/' + authMode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Ошибка входа'; return; }
    setSession(data.token, data.user);
    hideAuth();
    startApp();
  } catch (err) {
    errEl.textContent = 'Сетевая ошибка';
  }
}

function setupAuthUI() {
  const form = document.getElementById('auth-form');
  if (form) form.addEventListener('submit', handleAuth);
  const sw = document.getElementById('auth-switch-btn');
  const swText = document.getElementById('auth-switch-text');
  if (sw) sw.addEventListener('click', e => {
    e.preventDefault();
    authMode = authMode === 'login' ? 'register' : 'login';
    updateAuthModeUI();
  });
  updateAuthModeUI();
  // Узнаём, открыта ли регистрация; если закрыта — прячем переключатель
  fetch('/api/auth/config').then(r => r.json()).then(cfg => {
    if (!cfg.allowRegister) {
      authMode = 'login';
      if (sw) sw.style.display = 'none';
      if (swText) swText.style.display = 'none';
      updateAuthModeUI();
    }
  }).catch(() => {});
}

/* ──────────────────── APP START ──────────────────── */
async function startApp() {
  if (appStarted) {
    await loadAll();
    renderPage(activePage);
    return;
  }
  appStarted = true;
  await loadAll();

  document.querySelectorAll('.navbar-nav .nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigate(item.dataset.page);
    });
  });
  document.querySelectorAll('[data-page]').forEach(btn => {
    if (!btn.classList.contains('nav-item')) btn.addEventListener('click', () => navigate(btn.dataset.page));
  });
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('quick-add-btn').addEventListener('click',   () => openQuickAdd('expense'));
  document.getElementById('fab-add')?.addEventListener('click',        () => openQuickAdd('expense'));
  document.getElementById('add-income-btn')?.addEventListener('click', () => openQuickAdd('income'));
  document.getElementById('add-expense-btn')?.addEventListener('click',() => openQuickAdd('expense'));
  document.getElementById('add-mandatory-btn')?.addEventListener('click', openMandatoryModal);

  // ── Assets ──
  document.getElementById('add-asset-btn')?.addEventListener('click', () => openAssetModal('deposit'));
  document.getElementById('refresh-prices-btn')?.addEventListener('click', refreshPrices);
  document.querySelectorAll('[data-add-asset]').forEach(btn =>
    btn.addEventListener('click', () => openAssetModal(btn.dataset.addAsset)));
  document.getElementById('asset-type')?.addEventListener('change', e => switchAssetType(e.target.value));
  document.getElementById('asset-modal-close')?.addEventListener('click', closeAssetModal);
  document.getElementById('asset-modal-cancel')?.addEventListener('click', closeAssetModal);
  document.getElementById('asset-modal-save')?.addEventListener('click', saveAsset);
  document.getElementById('asset-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAssetModal(); });
  document.getElementById('asset-crypto-search')?.addEventListener('input', searchCryptoInput);
  document.getElementById('asset-qty-crypto')?.addEventListener('input', updateCryptoPreview);
  document.getElementById('asset-qty-broker')?.addEventListener('input', updateBrokerPreview);
  document.getElementById('asset-price-broker')?.addEventListener('input', updateBrokerPreview);
  document.getElementById('fetch-stock-btn')?.addEventListener('click', fetchStockQuote);
  api('GET', '/quotes/config').then(cfg => { quotesConfig = cfg; }).catch(() => {});
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setModalTab(btn.dataset.type));
  });
  document.querySelectorAll('#modal-source-toggle .source-opt').forEach(btn => {
    btn.addEventListener('click', () => setSourceToggle(btn.dataset.source));
  });
  document.getElementById('modal-close').addEventListener('click',  closeQuickModal);
  document.getElementById('modal-cancel').addEventListener('click', closeQuickModal);
  document.getElementById('modal-save').addEventListener('click',   saveQuickModal);
  document.getElementById('mandatory-modal-close').addEventListener('click',  closeMandatoryModal);
  document.getElementById('mandatory-modal-cancel').addEventListener('click', closeMandatoryModal);
  document.getElementById('mandatory-modal-save').addEventListener('click',   saveMandatoryModal);
  document.getElementById('confirm-no').addEventListener('click',  closeConfirm);
  document.getElementById('confirm-yes').addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeConfirm(); });
  document.getElementById('quick-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeQuickModal(); });
  document.getElementById('mandatory-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMandatoryModal(); });
  document.getElementById('confirm-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeQuickModal(); closeMandatoryModal(); closeConfirm(); closeAssetModal(); }
    if (e.key === 'Enter' && document.getElementById('quick-modal').style.display !== 'none') saveQuickModal();
  });

  document.getElementById('save-cash').addEventListener('click', async () => {
    const cashVal = parseFloat(document.getElementById('cash-input').value) || 0;
    const cardVal = parseFloat(document.getElementById('card-input').value) || 0;
    try {
      await saveAccountBalance('Наличные', 'cash', cashVal);
      await saveAccountBalance('Карта', 'card', cardVal);
      state.accounts = await api('GET', '/accounts');
      renderPage('dashboard');
      showToast('Балансы сохранены!');
    } catch (e) { showToast('Ошибка сохранения', '#ff3b30'); }
  });

  document.getElementById('save-salary').addEventListener('click', async () => {
    state.salary.day    = parseInt(document.getElementById('salary-day-input').value) || null;
    state.salary.amount = parseFloat(document.getElementById('salary-amount-input').value) || 0;
    state.salary.period = document.getElementById('salary-period-input').value;
    await api('PUT', '/settings/salary', { value: state.salary });
    renderPage('dashboard'); showToast('Данные ЗП сохранены!');
  });

  document.getElementById('add-income-cat-btn').addEventListener('click', async () => {
    const v = document.getElementById('new-income-cat').value.trim();
    if (v && !state.incomeCategories.includes(v)) {
      state.incomeCategories.push(v);
      document.getElementById('new-income-cat').value = '';
      await api('PUT', '/settings/income_categories', { value: state.incomeCategories });
      renderSettings();
    }
  });
  document.getElementById('new-income-cat').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-income-cat-btn').click();
  });
  document.getElementById('add-expense-cat-btn').addEventListener('click', async () => {
    const v = document.getElementById('new-expense-cat').value.trim();
    if (v && !state.expenseCategories.includes(v)) {
      state.expenseCategories.push(v);
      document.getElementById('new-expense-cat').value = '';
      await api('PUT', '/settings/expense_categories', { value: state.expenseCategories });
      renderSettings();
    }
  });
  document.getElementById('new-expense-cat').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-expense-cat-btn').click();
  });

  document.getElementById('clear-data-btn').addEventListener('click', () => {
    openConfirm('Удалить ВСЕ данные? Это действие нельзя отменить.', async () => {
      try {
        for (const i of state.incomes) await api('DELETE', `/incomes/${i.id}`);
        for (const i of state.expenses) await api('DELETE', `/expenses/${i.id}`);
        for (const i of state.mandatory) await api('DELETE', `/mandatory/${i.id}`);
        state.cash = 0;
        state.salary = { day: null, amount: 0, period: 'monthly' };
        state.incomeCategories = [...DEFAULT_INCOME_CATS];
        state.expenseCategories = [...DEFAULT_EXPENSE_CATS];
        await api('PUT', '/settings/cash', { value: 0 });
        await api('PUT', '/settings/salary', { value: state.salary });
        await api('PUT', '/settings/income_categories', { value: state.incomeCategories });
        await api('PUT', '/settings/expense_categories', { value: state.expenseCategories });
        state.incomes = []; state.expenses = []; state.mandatory = [];
        renderPage(activePage); showToast('Данные очищены', '#ef4444');
      } catch (e) { showToast('Ошибка очистки', '#ef4444'); }
    });
  });

  document.getElementById('income-filter-month').addEventListener('change',  renderIncomeRows);
  document.getElementById('income-filter-cat').addEventListener('change',    renderIncomeRows);
  document.getElementById('expense-filter-month').addEventListener('change', renderExpenseRows);
  document.getElementById('expense-filter-cat').addEventListener('change',   renderExpenseRows);
  document.getElementById('analytics-period').addEventListener('change', renderAnalytics);

  navigate('dashboard');
}

/* ──────────────────── INIT ──────────────────── */
function init() {
  setupAuthUI();
  if (getToken()) startApp();
  else showAuth();
}

document.addEventListener('DOMContentLoaded', init);
