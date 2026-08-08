export const DEFAULT_INCOME_CATS = ['Зарплата', 'Фриланс', 'Подработка', 'Подарок', 'Инвестиции', 'Прочее'];
export const DEFAULT_EXPENSE_CATS = ['Еда', 'Транспорт', 'Жильё', 'Одежда', 'Здоровье', 'Развлечения', 'Связь', 'Коммуналка', 'Кредит', 'Прочее'];

// ── Владивостокское время (UTC+10, без DST) ──
// Все "текущее время"/"текущий месяц" в приложении считаются по Владивостоку,
// а не по локальному времени браузера/сервера.
const VVO_OFFSET_MIN = 10 * 60;

// Дата, чьи getUTC*-геттеры отдают владивостокский wall-clock "сейчас"
export function nowVladivostok() {
  return new Date(Date.now() + VVO_OFFSET_MIN * 60000);
}

// Приводит сохранённую строку datetime к Date, чьи getUTC*-геттеры дают
// владивостокское wall-clock время — работает и для "наивных" строк
// (без Z/офсета — трактуются как уже владивостокские) и для абсолютных
// ISO-строк с Z/офсетом (сдвигаются на +10ч от их истинного UTC-момента).
function vvoDate(dt) {
  if (typeof dt === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(dt)) {
    return new Date(dt + 'Z');
  }
  return new Date(new Date(dt).getTime() + VVO_OFFSET_MIN * 60000);
}

export const SPENDABLE_TYPES = ['cash', 'card'];
export const INVEST_TYPES = ['deposit', 'crypto', 'broker'];

export function fmt(n, sign = false) {
  const abs = Math.abs(Number(n)).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  if (sign) return (n >= 0 ? '+' : '−') + abs + ' ₽';
  return abs + ' ₽';
}

// timeZone:'UTC' здесь намеренно — dt уже приведён к Date, чьи UTC-геттеры
// хранят владивостокское время, поэтому Intl просто читает их как есть,
// не пересчитывая под часовой пояс браузера.
export function fmtDate(dt) {
  return vvoDate(dt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDateTime(dt) {
  return vvoDate(dt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export function now() {
  const d = nowVladivostok();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Светлое время суток по Владивостоку — используется для авто-темы
export function isDaytimeVladivostok() {
  const h = nowVladivostok().getUTCHours();
  return h >= 6 && h < 18;
}

export function currentMonth() {
  const d = nowVladivostok();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function inPeriod(dt, period) {
  const d = vvoDate(dt);
  const n = nowVladivostok();
  if (period === 'month') return d.getUTCMonth() === n.getUTCMonth() && d.getUTCFullYear() === n.getUTCFullYear();
  if (period === '3month') { const c = new Date(n); c.setUTCMonth(c.getUTCMonth() - 3); return d >= c; }
  if (period === '6month') { const c = new Date(n); c.setUTCMonth(c.getUTCMonth() - 6); return d >= c; }
  if (period === 'year') { const c = new Date(n); c.setUTCFullYear(c.getUTCFullYear() - 1); return d >= c; }
  return true;
}

export function getCategoryColor(name) {
  const colors = ['#0071e3', '#34c759', '#5ac8fa', '#ff9500', '#af52de', '#ff2d55', '#30b0c7', '#ffcc00', '#ff3b30', '#64d2ff'];
  let hash = 0;
  for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export function getNextSalaryDate(salary) {
  if (!salary.day) return null;
  const today = nowVladivostok();
  const day = salary.day;
  let next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day));
  if (next <= today) next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day));
  return next;
}

export function daysUntilSalary(salary) {
  const next = getNextSalaryDate(salary);
  if (!next) return null;
  return Math.ceil((next - nowVladivostok()) / (1000 * 60 * 60 * 24));
}

export function accountsByType(accounts, type) {
  return accounts.filter(a => a.type === type);
}
export function sumBalances(accounts, types) {
  return accounts
    .filter(a => types.includes(a.type))
    .reduce((s, a) => s + (Number(a.balance) || 0), 0);
}
export function spendableTotal(accounts) { return sumBalances(accounts, SPENDABLE_TYPES); }
export function investTotal(accounts) { return sumBalances(accounts, INVEST_TYPES); }
export function netWorth(accounts) { return spendableTotal(accounts) + investTotal(accounts); }

export function findAccountByName(accounts, name) {
  return accounts.find(a => a.name === name);
}
export const ASSET_TYPE_LABEL = { deposit: 'Вклад', crypto: 'Криптовалюта', broker: 'Акция' };

export function getCategoryEmoji(cat) {
  const map = {
    'Еда': '🍕', 'Транспорт': '🚗', 'Жильё': '🏠', 'Одежда': '👗', 'Здоровье': '💊',
    'Развлечения': '🎮', 'Связь': '📱', 'Коммуналка': '💡', 'Кредит': '🏦', 'Прочее': '📦',
    'Зарплата': '💼', 'Фриланс': '💻', 'Подработка': '🔧', 'Подарок': '🎁', 'Инвестиции': '📊'
  };
  return map[cat] || '💰';
}

export function sourceLabel(src) {
  const s = src || 'Наличные';
  const emoji = { 'Наличные': '💵', 'Карта': '💳' }[s] || '💰';
  return `${emoji} ${s}`;
}

export function typeLabel(t) {
  return { monthly: 'Ежемесячно', once: 'Разово', yearly: 'Ежегодно' }[t] || t;
}

export const DEBT_DIRECTION_LABEL = { i_owe: 'Я должен', owe_me: 'Мне должны' };
export function debtDirectionLabel(d) { return DEBT_DIRECTION_LABEL[d] || d; }

export function assetEmoji(type) {
  return { deposit: '🏦', crypto: '₿', broker: '📊' }[type] || '💰';
}

export function fmtPercent(n) {
  const v = Number(n);
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

// % доходности крипты/акций: (текущая стоимость − вложено) / вложено
export function returnPct(a) {
  if (a.cost_basis == null || a.cost_basis === 0) return null;
  return ((a.balance - a.cost_basis) / a.cost_basis) * 100;
}

// Оценка накопленных процентов по вкладу — простые проценты со дня открытия.
// Ориентировочно: реальные условия банка (капитализация, налог) могут отличаться.
export function depositAccrued(a) {
  const rate = a.meta && a.meta.rate;
  if (!rate || !a.purchased_at) return null;
  const days = (Date.now() - new Date(a.purchased_at).getTime()) / 86400000;
  if (days < 0) return null;
  const accrued = a.balance * (rate / 100) * (days / 365);
  return { accrued, days: Math.floor(days), pct: a.balance ? (accrued / a.balance) * 100 : 0 };
}

// Подсказывает категорию по истории операций: сначала ищем совпадение
// Явное правило «сумма расхода ≤ maxAmount → категория» (настраивается в
// Настройках). При нескольких подходящих правилах побеждает то, у которого
// maxAmount меньше — самая узкая подходящая «ступенька».
export function matchCategoryRule(rules, amount) {
  const amt = parseFloat(amount);
  if (!rules || !rules.length || isNaN(amt) || amt <= 0) return null;
  const candidates = rules.filter(r => amt <= Number(r.maxAmount));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Number(a.maxAmount) - Number(b.maxAmount));
  return candidates[0].category;
}

// по описанию (частичное, регистронезависимое), при отсутствии —
// по близкой сумме (±15% либо ±50₽, что больше). При нескольких
// кандидатах побеждает категория с наибольшим числом совпадений,
// при равенстве — из более свежей записи.
export function suggestCategory(entries, { description, amount }) {
  if (!entries || !entries.length) return null;
  const desc = (description || '').trim().toLowerCase();
  const amt = parseFloat(amount);
  const hasAmount = !isNaN(amt) && amt > 0;

  let matches = [];
  if (desc.length >= 3) {
    matches = entries.filter(e => {
      const ed = (e.description || '').toLowerCase();
      return ed.length >= 3 && (ed.includes(desc) || desc.includes(ed));
    });
  }
  if (!matches.length && hasAmount) {
    const tolerance = Math.max(amt * 0.15, 50);
    matches = entries.filter(e => Math.abs(Number(e.amount) - amt) <= tolerance);
  }
  if (!matches.length) return null;

  const scores = {};
  matches.forEach(e => {
    const cat = e.category;
    if (!cat) return;
    if (!scores[cat]) scores[cat] = { count: 0, latest: '' };
    scores[cat].count += 1;
    if (e.datetime > scores[cat].latest) scores[cat].latest = e.datetime;
  });
  const best = Object.entries(scores).sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return b[1].latest.localeCompare(a[1].latest);
  })[0];
  return best ? best[0] : null;
}

export function groupBy(arr, key) {
  const result = {};
  arr.forEach(item => { const k = item[key] || 'Прочее'; result[k] = (result[k] || 0) + Number(item.amount); });
  return result;
}
