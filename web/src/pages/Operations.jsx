import { useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, fmtDateTime, getCategoryEmoji, getCategoryColor, sourceLabel } from '../utils.js';

function populateMonths(data) {
  return [...new Set(data.map(d => d.datetime.slice(0, 7)))].sort().reverse();
}

export default function Operations({ toast, onDelete }) {
  const { state, reload } = useStore();
  const [tab, setTab] = useState('all'); // all | income | expense
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');

  const incomeMonths = populateMonths(state.incomes);
  const expenseMonths = populateMonths(state.expenses);
  const months = [...new Set([...incomeMonths, ...expenseMonths])].sort().reverse();

  let data = [
    ...state.incomes.map(i => ({ ...i, kind: 'income' })),
    ...state.expenses.map(e => ({ ...e, kind: 'expense' })),
  ];

  if (tab === 'income') data = data.filter(d => d.kind === 'income');
  if (tab === 'expense') data = data.filter(d => d.kind === 'expense');
  if (month) data = data.filter(d => d.datetime.startsWith(month));
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    data = data.filter(d =>
      (d.description || '').toLowerCase().includes(s) ||
      (d.category || '').toLowerCase().includes(s)
    );
  }
  data.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  const handleDelete = async (item) => {
    try {
      if (item.kind === 'income') {
        await api('DELETE', `/incomes/${item.id}`);
        await reload('incomes');
      } else {
        await api('DELETE', `/expenses/${item.id}`);
        await reload('expenses');
      }
      onDelete();
    } catch {
      toast('Ошибка удаления', '#ef4444');
    }
  };

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" data-action="add-expense">+ Добавить операцию</button>
      </div>

      <div className="modal-tabs ops-tabs">
        <button className={`tab-btn ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>Все</button>
        <button className={`tab-btn ${tab === 'income' ? 'active' : ''}`} onClick={() => setTab('income')}>📈 Доходы</button>
        <button className={`tab-btn ${tab === 'expense' ? 'active' : ''}`} onClick={() => setTab('expense')}>📉 Расходы</button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span>Все операции</span>
          <div className="filter-row">
            <input
              type="search"
              className="filter-select"
              placeholder="Поиск…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="filter-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Все месяцы</option>
              {months.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(y, mo - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Дата</th><th>Тип</th><th>Категория</th><th>Счёт</th><th>Описание</th><th>Сумма</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan="7" className="empty-cell">Нет операций</td></tr>
              ) : data.map(item => (
                <tr key={item.kind + item.id} className="tx-row-mobile">
                  <td data-label="Дата">{fmtDateTime(item.datetime)}</td>
                  <td data-label="Тип">
                    <span className={`src-badge ${item.kind === 'income' ? 'badge-income' : 'badge-expense'}`}>
                      {item.kind === 'income' ? 'Доход' : 'Расход'}
                    </span>
                  </td>
                  <td data-label="Категория">
                    <span className="cat-badge" style={{ background: getCategoryColor(item.category) + '22', color: getCategoryColor(item.category) }}>{item.category}</span>
                  </td>
                  <td data-label="Счёт"><span className="src-badge">{sourceLabel(item.source)}</span></td>
                  <td data-label="Описание">{item.description || '—'}</td>
                  <td data-label="Сумма" className={item.kind === 'income' ? 'amount-income' : 'amount-expense'}>
                    {item.kind === 'income' ? '+' : '−'}{fmt(item.amount)}
                  </td>
                  <td data-label=""><button className="action-btn" onClick={() => handleDelete(item)} title="Удалить">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
