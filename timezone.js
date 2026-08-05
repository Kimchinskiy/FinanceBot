// ===================================================================
// FinanceBot — timezone.js
// Владивосток: фиксированный UTC+10, без перехода на летнее время.
// Используется вместо московского/локального времени сервера везде,
// где считаются "текущий месяц"/"текущий день" для бизнес-логики.
// ===================================================================
const VVO_OFFSET_MIN = 10 * 60;

function nowVladivostok() {
  return new Date(Date.now() + VVO_OFFSET_MIN * 60000);
}

function currentMonthVladivostok() {
  const d = nowVladivostok();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentDayVladivostok() {
  return nowVladivostok().getUTCDate();
}

function nowVladivostokIso() {
  return nowVladivostok().toISOString();
}

module.exports = { nowVladivostok, currentMonthVladivostok, currentDayVladivostok, nowVladivostokIso, VVO_OFFSET_MIN };
