import { useStore } from '../store.jsx';
import { fmt, currentMonth, getCategoryEmoji, sourceLabel, typeLabel, getNextSalaryDate, daysUntilSalary, fmtDate, fmtDateTime, findAccountByName, sumBalances, spendableTotal, investTotal } from '../utils.js';

export default function Dashboard() {
  const { state } = useStore();
  const month = currentMonth();
  const thisIncome = state.incomes.filter(i => i.datetime.startsWith(month));
  const thisExpense = state.expenses.filter(e => e.datetime.startsWith(month));
  const totalIncome = thisIncome.reduce((s, i) => s + Number(i.amount), 0);
  const totalExpense = thisExpense.reduce((s, e) => s + Number(e.amount), 0);

  const cashBal = findAccountByName(state.accounts, 'Наличные')?.balance || 0;
  const cardBal = findAccountByName(state.accounts, 'Карта')?.balance || 0;
  const spendable = spendableTotal(state.accounts);
  const invest = investTotal(state.accounts);
  const net = spendable + invest;

  const dep = sumBalances(state.accounts, ['deposit']);
  const cr = sumBalances(state.accounts, ['crypto']);
  const br = sumBalances(state.accounts, ['broker']);
  const parts = [];
  if (dep) parts.push(`Вклады ${fmt(dep)}`);
  if (cr) parts.push(`Крипта ${fmt(cr)}`);
  if (br) parts.push(`Акции ${fmt(br)}`);

  const salary = state.salary;
  const nextSalary = getNextSalaryDate(salary);
  const days = daysUntilSalary(salary);

  const all = [
    ...state.incomes.map(i => ({ ...i, kind: 'income' })),
    ...state.expenses.map(e => ({ ...e, kind: 'expense' })),
  ].sort((a, b) => new Date(b.datetime) - new Date(a.datetime)).slice(0, 8);

  const mandItems = state.mandatory.slice(0, 5);

  return (
    <>
      <div className="cards-grid">
        <div className="card card-balance card-green">
          <div className="card-icon">💵</div>
          <div className="card-body">
            <div className="card-label">Доступно (нал + безнал)</div>
            <div className="card-value">{fmt(spendable)}</div>
            <div className="card-sub">Наличные {fmt(cashBal)} · Карта {fmt(cardBal)}</div>
          </div>
        </div>
        <div className="card card-purple">
          <div className="card-icon">📦</div>
          <div className="card-body">
            <div className="card-label">Активы / Инвестиции</div>
            <div className="card-value">{fmt(invest)}</div>
            <div className="card-sub">{parts.length ? parts.join(' · ') : 'Вклады · Крипта · Акции'}</div>
          </div>
        </div>
        <div className="card card-blue">
          <div className="card-icon">🏦</div>
          <div className="card-body">
            <div className="card-label">Чистый капитал</div>
            <div className="card-value">{fmt(net)}</div>
            <div className="card-sub">Всего по всем счетам</div>
          </div>
        </div>
        <div className="card card-green">
          <div className="card-icon">📈</div>
          <div className="card-body">
            <div className="card-label">Доходы (месяц)</div>
            <div className="card-value">{fmt(totalIncome)}</div>
            <div className="card-sub">{thisIncome.length} операций</div>
          </div>
        </div>
        <div className="card card-red">
          <div className="card-icon">📉</div>
          <div className="card-body">
            <div className="card-label">Расходы (месяц)</div>
            <div className="card-value">{fmt(totalExpense)}</div>
            <div className="card-sub">{thisExpense.length} операций</div>
          </div>
        </div>
      </div>

      {salary.day && (
        <div className="salary-countdown-bar" style={{ display: 'flex' }}>
          <div className="salary-bar-left">
            <span className="salary-icon">🗓️</span>
            <div>
              <div className="salary-bar-title">До следующей зарплаты</div>
              <div className="salary-bar-sub">{fmtDate(nextSalary)}</div>
            </div>
          </div>
          <div className="salary-bar-right">
            <div className="days-chip">{days === 0 ? '🎉 Сегодня!' : `${days} дн.`}</div>
            <div className="salary-expected">{salary.amount ? fmt(salary.amount) : ''}</div>
          </div>
        </div>
      )}

      <div className="two-col">
        <div className="panel">
          <div className="panel-header">
            <span>Последние операции</span>
            <button className="link-btn" data-nav="expenses">Все →</button>
          </div>
          <div className="transactions-list">
            {all.length === 0 ? (
              <div className="empty-state">Нет операций. Добавьте первую!</div>
            ) : all.map((t, i) => (
              <div key={i} className={`tx-item tx-${t.kind}`}>
                <div className="tx-icon">{t.kind === 'income' ? '📈' : getCategoryEmoji(t.category)}</div>
                <div className="tx-info">
                  <div className="tx-name">{t.description || t.category}</div>
                  <div className="tx-cat">{t.category} · {sourceLabel(t.source)}</div>
                </div>
                <div>
                  <div className="tx-amount">{t.kind === 'income' ? '+' : '−'}{fmt(t.amount)}</div>
                  <div className="tx-date">{fmtDateTime(t.datetime)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <span>Обязательные платежи</span>
            <button className="link-btn" data-nav="mandatory">Все →</button>
          </div>
          <div className="mandatory-list">
            {mandItems.length === 0 ? (
              <div className="empty-state">Нет обязательных платежей</div>
            ) : mandItems.map(m => (
              <div key={m.id} className="m-item">
                <div>
                  <div className="m-name">{m.name}</div>
                  <div className="m-meta">{m.category} · {typeLabel(m.type)} · {m.day || '—'} число</div>
                </div>
                <div className="m-right">
                  <div className="m-amount">{fmt(m.amount)}</div>
                  <div className={`m-status ${m.status}`}>{m.status === 'paid' ? 'Оплачен' : 'Ожидает'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
