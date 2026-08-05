// ===================================================================
// FinanceBot — lock.js
// Простой in-memory мьютекс по userId: сериализует операции чтения-затем-
// записи баланса (toggle, покупка/оплата по кредитке), чтобы конкурентные
// запросы одного пользователя не могли интерлевиться между SELECT и UPDATE
// и не приводили к двойному списанию/начислению.
// ===================================================================
const locks = new Map();

function withUserLock(userId, fn) {
  const prev = locks.get(userId) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(userId, run.then(() => {}, () => {}));
  return run;
}

module.exports = { withUserLock };
