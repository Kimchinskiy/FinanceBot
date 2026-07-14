/* ===================================================================
   FinanceBot — app.js (Postgres backend)
   Full logic: state, rendering, charts, modals, API persistence
=================================================================== */

const API = '/api';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
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
  cash:       0,
  salary:     { day: null, amount: 0, period: 'monthly' },
  incomeCategories:  [...DEFAULT_INCOME_CATS],
  expenseCategories: [...DEFAULT_EXPENSE_CATS],
};

/* ──────────────────── LOAD FROM API ──────────────────── */
async function loadAll() {
  try {
    const [incomes, expenses, mandatory, settings] = await Promise.all([
      api('GET', '/incomes'),
      api('GET', '/expenses'),
      api('GET', '/mandatory'),
      api('GET', '/settings'),
    ]);
    state.incomes = incomes;
    state.expenses = expenses;
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
  const colors = ['#6366f1','#22c55e','#3b82f6','#f97316','#a855f7','#ec4899','#14b8a6','#eab308','#ef4444','#06b6d4'];
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
    dashboard: 'Дашборд', income: 'Доходы', expenses: 'Расходы',
    mandatory: 'Обязательные платежи', analytics: 'Аналитика', settings: 'Настройки'
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
  const mandatoryTotal = state.mandatory.filter(m => m.status === 'pending')
    .reduce((s,m) => s + Number(m.amount), 0);
  const allIncome  = state.incomes.reduce((s,i) => s + Number(i.amount), 0);
  const allExpense = state.expenses.reduce((s,e) => s + Number(e.amount), 0);
  const totalBalance = allIncome - allExpense + Number(state.cash);

  document.getElementById('total-balance').textContent = fmt(totalBalance);
  document.getElementById('monthly-income').textContent = fmt(totalIncome);
  document.getElementById('monthly-expense').textContent = fmt(totalExpense);
  document.getElementById('cash-amount').textContent = fmt(state.cash);
  document.getElementById('income-count').textContent = `${thisIncome.length} операций`;
  document.getElementById('expense-count').textContent = `${thisExpense.length} операций`;

  const profit = totalIncome - totalExpense;
  const changeEl = document.getElementById('balance-change');
  changeEl.textContent = fmt(profit, true) + ' за этот месяц';
  changeEl.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';

  renderSalaryBar();
  renderRecentTransactions();
  renderDashboardMandatory();
  renderDashChart();
}

function renderSalaryBar() {
  const bar = document.getElementById('salary-bar');
  const sideDate = document.getElementById('salary-sidebar-date');
  const sideAmt  = document.getElementById('salary-sidebar-amount');
  if (!state.salary.day) { bar.style.display = 'none'; sideDate.textContent = '—'; sideAmt.textContent = '—'; return; }
  const next = getNextSalaryDate();
  const days = daysUntilSalary();
  bar.style.display = 'flex';
  document.getElementById('salary-bar-sub').textContent = fmtDate(next);
  document.getElementById('salary-days-chip').textContent = days === 0 ? '🎉 Сегодня!' : `${days} дн.`;
  document.getElementById('salary-expected').textContent = state.salary.amount ? fmt(state.salary.amount) : '';
  sideDate.textContent = fmtDate(next);
  sideAmt.textContent = state.salary.amount ? fmt(state.salary.amount) : '—';
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
        <div class="tx-cat">${t.category}</div>
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

function renderDashChart() {
  const ctx = document.getElementById('dashChart');
  if (!ctx) return;
  if (chartInstances['dashChart']) chartInstances['dashChart'].destroy();
  const labels = []; const inc = []; const exp = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    labels.push(d.toLocaleDateString('ru-RU', {day:'numeric', month:'short'}));
    inc.push(state.incomes.filter(t => t.datetime.startsWith(key)).reduce((s,t) => s + Number(t.amount), 0));
    exp.push(state.expenses.filter(t => t.datetime.startsWith(key)).reduce((s,t) => s + Number(t.amount), 0));
  }
  chartInstances['dashChart'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Доходы', data: inc, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 },
        { label: 'Расходы', data: exp, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: chartDefaults()
  });
}

function chartDefaults() {
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#7c85a2', font: { family: 'Inter', size: 12 }, boxWidth: 12, padding: 16 } },
      tooltip: {
        backgroundColor: '#1a1e2a', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
        titleColor: '#f0f2ff', bodyColor: '#7c85a2', padding: 12,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('ru-RU')} ₽` }
      }
    },
    scales: {
      x: { ticks: { color: '#4a5168', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#4a5168', font: { size: 10 }, callback: v => v.toLocaleString('ru-RU') }, grid: { color: 'rgba(255,255,255,0.04)' } }
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
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Нет доходов</td></tr>'; return; }
  tbody.innerHTML = data.map(i => `
    <tr>
      <td>${fmtDateTime(i.datetime)}</td>
      <td><span class="cat-badge" style="background:${getCategoryColor(i.category)}22;color:${getCategoryColor(i.category)}">${i.category}</span></td>
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
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Нет расходов</td></tr>'; return; }
  tbody.innerHTML = data.map(e => `
    <tr>
      <td>${fmtDateTime(e.datetime)}</td>
      <td><span class="cat-badge" style="background:${getCategoryColor(e.category)}22;color:${getCategoryColor(e.category)}">${e.category}</span></td>
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
      datasets: [{ data: values, backgroundColor: colors.map(c => c + 'cc'), borderColor: colors, borderWidth: 2, hoverBorderWidth: 3, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7c85a2', font: { family: 'Inter', size: 12 }, padding: 14, boxWidth: 12 } },
        tooltip: { backgroundColor: '#1a1e2a', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, titleColor: '#f0f2ff', bodyColor: '#7c85a2', padding: 12, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('ru-RU')} ₽` } }
      },
      cutout: '62%'
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
  let running = Number(state.cash);
  const labels = []; const data = [];
  if (allTx.length) {
    const first = new Date(allTx[0].date);
    labels.push(fmtDate(first)); data.push(running);
    allTx.forEach(tx => { running += tx.amount; labels.push(fmtDate(tx.date)); data.push(running); });
  } else { labels.push('Сейчас'); data.push(running); }
  const positiveColor = '#22c55e'; const negativeColor = '#ef4444';
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
  document.getElementById('cash-input').value = state.cash || '';
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

/* ──────────────────── MODALS ──────────────────── */
let modalType = 'expense';

function openQuickAdd(type = 'expense') {
  modalType = type;
  editingId = null;
  document.getElementById('modal-title').textContent = 'Добавить операцию';
  document.getElementById('modal-amount').value = '';
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-date').value = now();
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

function closeQuickModal() { document.getElementById('quick-modal').style.display = 'none'; }

async function saveQuickModal() {
  const amount = parseFloat(document.getElementById('modal-amount').value);
  const category = document.getElementById('modal-category').value;
  const description = document.getElementById('modal-desc').value.trim();
  const datetime = document.getElementById('modal-date').value || now();
  if (!amount || amount <= 0) { shakeField('modal-amount'); return; }

  try {
    if (modalType === 'income') {
      await api('POST', '/incomes', { amount, category, description, datetime });
      state.incomes = await api('GET', '/incomes');
    } else {
      await api('POST', '/expenses', { amount, category, description, datetime });
      state.expenses = await api('GET', '/expenses');
    }
    closeQuickModal();
    renderPage(activePage);
    showToast(`${modalType === 'income' ? 'Доход' : 'Расход'} добавлен!`);
  } catch (e) {
    showToast('Ошибка сохранения', '#ef4444');
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
function showToast(msg, color = '#22c55e') {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position:'fixed', bottom:'28px', left:'50%', transform:'translateX(-50%) translateY(20px)',
    background: '#1a1e2a', color:'#f0f2ff', padding:'12px 24px',
    borderRadius:'99px', fontSize:'14px', fontWeight:'600',
    boxShadow:'0 4px 24px rgba(0,0,0,0.4)', zIndex:'9999',
    border:`1px solid ${color}44`,
    transition:'all 0.3s ease', opacity:'0'
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
  el.style.borderColor = '#ef4444';
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = 'shake 0.4s ease'; });
  el.addEventListener('input', () => { el.style.borderColor = ''; el.style.animation = ''; }, { once:true });
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }`;
document.head.appendChild(shakeStyle);

/* ──────────────────── EXPORT / IMPORT ──────────────────── */
async function exportData() {
  const data = {
    incomes: state.incomes,
    expenses: state.expenses,
    mandatory: state.mandatory,
    cash: state.cash,
    salary: state.salary,
    income_categories: state.incomeCategories,
    expense_categories: state.expenseCategories,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `financebot_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast('Данные экспортированы!');
}

async function importData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.incomes) for (const i of data.incomes) await api('POST', '/incomes', i);
      if (data.expenses) for (const i of data.expenses) await api('POST', '/expenses', i);
      if (data.mandatory) for (const i of data.mandatory) await api('POST', '/mandatory', i);
      if (data.cash !== undefined) await api('PUT', '/settings/cash', { value: data.cash });
      if (data.salary) await api('PUT', '/settings/salary', { value: data.salary });
      if (data.income_categories) await api('PUT', '/settings/income_categories', { value: data.income_categories });
      if (data.expense_categories) await api('PUT', '/settings/expense_categories', { value: data.expense_categories });
      await loadAll();
      renderPage(activePage);
      showToast('Данные импортированы!');
    } catch(err) { showToast('Ошибка импорта', '#ef4444'); }
  };
  reader.readAsText(file);
}

/* ──────────────────── INIT ──────────────────── */
async function init() {
  await loadAll();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigate(item.dataset.page);
      if (window.innerWidth < 700) document.getElementById('sidebar').classList.remove('open');
    });
  });
  document.querySelectorAll('[data-page]').forEach(btn => {
    if (!btn.classList.contains('nav-item')) btn.addEventListener('click', () => navigate(btn.dataset.page));
  });
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('quick-add-btn').addEventListener('click',   () => openQuickAdd('expense'));
  document.getElementById('add-income-btn')?.addEventListener('click', () => openQuickAdd('income'));
  document.getElementById('add-expense-btn')?.addEventListener('click',() => openQuickAdd('expense'));
  document.getElementById('add-mandatory-btn')?.addEventListener('click', openMandatoryModal);
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setModalTab(btn.dataset.type));
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
    if (e.key === 'Escape') { closeQuickModal(); closeMandatoryModal(); closeConfirm(); }
    if (e.key === 'Enter' && document.getElementById('quick-modal').style.display !== 'none') saveQuickModal();
  });

  document.getElementById('save-cash').addEventListener('click', async () => {
    state.cash = parseFloat(document.getElementById('cash-input').value) || 0;
    await api('PUT', '/settings/cash', { value: state.cash });
    renderPage('dashboard'); showToast('Наличные сохранены!');
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

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
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

document.addEventListener('DOMContentLoaded', init);
