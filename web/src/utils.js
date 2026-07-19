export const DEFAULT_INCOME_CATS = ['Зарплата', 'Фриланс', 'Подработка', 'Подарок', 'Инвестиции', 'Прочее'];
export const DEFAULT_EXPENSE_CATS = ['Еда', 'Транспорт', 'Жильё', 'Одежда', 'Здоровье', 'Развлечения', 'Связь', 'Коммуналка', 'Кредит', 'Прочее'];

export const SPENDABLE_TYPES = ['cash', 'card'];
export const INVEST_TYPES = ['deposit', 'crypto', 'broker'];

export function fmt(n, sign = false) {
  const abs = Math.abs(Number(n)).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  if (sign) return (n >= 0 ? '+' : '−') + abs + ' ₽';
  return abs + ' ₽';
}

export function fmtDate(dt) {
  return new Date(dt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(dt) {
  return new Date(dt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function now() {
  return new Date().toISOString().slice(0, 16);
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function inPeriod(dt, period) {
  const d = new Date(dt);
  const n = new Date();
  if (period === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  if (period === '3month') { const c = new Date(); c.setMonth(c.getMonth() - 3); return d >= c; }
  if (period === '6month') { const c = new Date(); c.setMonth(c.getMonth() - 6); return d >= c; }
  if (period === 'year') { const c = new Date(); c.setFullYear(c.getFullYear() - 1); return d >= c; }
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
  const today = new Date();
  const day = salary.day;
  let next = new Date(today.getFullYear(), today.getMonth(), day);
  if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, day);
  return next;
}

export function daysUntilSalary(salary) {
  const next = getNextSalaryDate(salary);
  if (!next) return null;
  return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24));
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

export function groupBy(arr, key) {
  const result = {};
  arr.forEach(item => { const k = item[key] || 'Прочее'; result[k] = (result[k] || 0) + Number(item.amount); });
  return result;
}
