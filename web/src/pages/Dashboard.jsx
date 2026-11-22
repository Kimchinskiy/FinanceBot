import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, currentMonth, getCategoryEmoji, sourceLabel, typeLabel, getNextSalaryDate, daysUntilSalary, fmtDate, fmtDateTime, findAccountByName, sumBalances, spendableTotal, investTotal } from '../utils.js';
import Icon, { CategoryIcon } from '../components/Icon.jsx';

export default function Dashboard() {
  const { state, user } = useStore();
  const [summaryTips, setSummaryTips] = useState(null);

  useEffect(() => {
    api('GET', '/ai/monthly-summary').then(res => setSummaryTips(res.tips || [])).catch(() => setSummaryTips([]));
  }, []);
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
  const lastSalaryIncome = state.incomes
    .filter(i => i.category === 'Зарплата')
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))[0];

  const all = [
    ...state.incomes.map(i => ({ ...i, kind: 'income' })),
    ...state.expenses.map(e => ({ ...e, kind: 'expense' })),
  ].sort((a, b) => new Date(b.datetime) - new Date(a.datetime)).slice(0, 8);

  const mandItems = state.mandatory.slice(0, 5);
  const budgetItems = Object.entries(state.budgets || {}).map(([category, limit]) => {
    const spent = thisExpense.filter(e => e.category === category).reduce((s, e) => s + Number(e.amount), 0);
    const amount = Number(limit);
    return { category, limit: amount, spent, percent: amount ? Math.round(spent / amount * 100) : 0 };
  }).filter(b => b.limit > 0);

  return (
    <>
      <div className="dashboard-intro">
        <div>
          <div className="dashboard-eyebrow">ФИНАНСЫ · ОБЗОР</div>
          <h1 className="dashboard-title">Добрый день{user?.first_name ? `, ${user.first_name}` : ''}</h1>
          <p className="dashboard-subtitle">Следите за деньгами и принимайте решения спокойнее.</p>
        </div>
        <div className="dashboard-actions">
          <button className="btn-outline dashboard-action" data-action="add-income">＋ Доход</button>
          <button className="btn-primary dashboard-action" data-action="add-expense">＋ Расход</button>
        </div>
      </div>
      <div className="cards-grid">
        <div className="card card-balance card-green">
          <div className="card-body">
            <div className="card-label">Доступно (нал + безнал)</div>
            <div className="card-value">{fmt(spendable)}</div>
            <div className="card-sub">Наличные {fmt(cashBal)} · Карта {fmt(cardBal)}</div>
          </div>
        </div>
        <div className="card card-purple">
          <div className="card-body">
            <div className="card-label">Активы / Инвестиции</div>
            <div className="card-value">{fmt(invest)}</div>
            <div className="card-sub">{parts.length ? parts.join(' · ') : 'Вклады · Крипта · Акции'}</div>
          </div>
        </div>
        <div className="card card-blue">
          <div className="card-body">
            <div className="card-label">Чистый капитал</div>
            <div className="card-value">{fmt(net)}</div>
            <div className="card-sub">Всего по всем счетам</div>
          </div>
        </div>
        <div className="card card-green">
          <div className="card-body">
            <div className="card-label">Доходы (месяц)</div>
            <div className="card-value">{fmt(totalIncome)}</div>
            <div className="card-sub">{thisIncome.length} операций</div>
          </div>
        </div>
        <div className="card card-red">
          <div className="card-body">
            <div className="card-label">Расходы (месяц)</div>
            <div className="card-value">{fmt(totalExpense)}</div>
            <div className="card-sub">{thisExpense.length} операций</div>
          </div>
        </div>
      </div>

      {summaryTips && summaryTips.length > 0 && (
        <div className="panel">
          <div className="panel-header"><span><Icon name="bot" /> AI-сводка месяца</span></div>
          <div className="settings-form">
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {summaryTips.map((t, i) => <li key={i} className="text-muted" style={{ fontSize: 14 }}>{t}</li>)}
            </ul>
          </div>
        </div>
      )}

      {nextSalary && (
        <div className="salary-countdown-bar" style={{ display: 'flex' }}>
          <div className="salary-bar-left">
            <span className="salary-icon"><Icon name="calendar" /></span>
            <div>
              <div className="salary-bar-title">До следующей зарплаты</div>
              <div className="salary-bar-sub">{fmtDate(nextSalary)}</div>
            </div>
          </div>
          <div className="salary-bar-right">
            <div className="days-chip">{days === 0 ? '🎉 Сегодня!' : `${days} дн.`}</div>
            <div className="salary-expected">{lastSalaryIncome ? fmt(lastSalaryIncome.amount) : ''}</div>
          </div>
        </div>
      )}

      {budgetItems.length > 0 && <div className="panel budget-panel">
        <div className="panel-header"><span><Icon name="chart" /> Бюджеты этого месяца</span><button className="link-btn" data-nav="settings">Настроить →</button></div>
        <div className="budget-list">
          {budgetItems.map(b => <div className="budget-row" key={b.category}>
            <div className="budget-row-top"><span>{b.category}</span><span className={b.percent > 100 ? 'budget-over' : ''}>{fmt(b.spent)} из {fmt(b.limit)}</span></div>
            <div className="budget-track"><div className={`budget-fill ${b.percent > 100 ? 'over' : b.percent >= 80 ? 'warning' : ''}`} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
            <div className="budget-caption">{b.percent > 100 ? `Превышение на ${fmt(b.spent - b.limit)}` : `${b.percent}% использовано`}</div>
          </div>)}
        </div>
      </div>}

      <div className="two-col">
        <div className="panel">
          <div className="panel-header">
            <span>Последние операции</span>
            <button className="link-btn" data-nav="operations">Все →</button>
          </div>
          <div className="transactions-list">
            {all.length === 0 ? (
              <div className="empty-state empty-action-state">
                <span className="empty-state-icon"><Icon name="receipt" size={30} /></span>
                <strong>Пока нет операций</strong>
                <span>Добавьте первую, чтобы начать вести учёт.</span>
                <button className="link-btn" data-action="add-expense">Добавить расход →</button>
              </div>
            ) : all.map((t, i) => (
              <div key={i} className={`tx-item tx-${t.kind}`}>
              <div className="tx-icon">{t.kind === 'income' ? <Icon name="upTrend" /> : <CategoryIcon category={t.category} />}</div>
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
              <div className="empty-state empty-action-state">
                <span className="empty-state-icon"><Icon name="calendar" size={30} /></span>
                <strong>Платежей пока нет</strong>
                <span>Добавьте регулярный платёж, чтобы не забыть о нём.</span>
                <button className="link-btn" data-action="add-mandatory">Добавить платёж →</button>
              </div>
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
