import { useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, fmtDateTime, getCategoryColor, sourceLabel } from '../utils.js';

function populateMonths(data) {
  return [...new Set(data.map(d => d.datetime.slice(0, 7)))].sort().reverse();
}

export default function Expenses({ onDelete }) {
  const { state, reload } = useStore();
  const [month, setMonth] = useState('');
  const [cat, setCat] = useState('');

  const months = populateMonths(state.expenses);
  let data = [...state.expenses].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  if (month) data = data.filter(e => e.datetime.startsWith(month));
  if (cat) data = data.filter(e => e.category === cat);

  const handleDelete = async (id) => {
    await api('DELETE', `/expenses/${id}`);
    await reload('expenses');
    onDelete();
  };

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" data-action="add-expense">+ Добавить расход</button>
      </div>
      <div className="panel">
        <div className="panel-header">
          <span>Все расходы</span>
          <div className="filter-row">
            <select className="filter-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Все месяцы</option>
              {months.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(y, mo - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
            <select className="filter-select" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Все категории</option>
              {state.expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Дата</th><th>Категория</th><th>Счёт</th><th>Описание</th><th>Сумма</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan="6" className="empty-cell">Нет расходов</td></tr>
              ) : data.map(e => (
                <tr key={e.id} className="tx-row-mobile">
                  <td data-label="Дата">{fmtDateTime(e.datetime)}</td>
                  <td data-label="Категория"><span className="cat-badge" style={{ background: getCategoryColor(e.category) + '22', color: getCategoryColor(e.category) }}>{e.category}</span></td>
                  <td data-label="Счёт"><span className="src-badge">{sourceLabel(e.source)}</span></td>
                  <td data-label="Описание">{e.description || '—'}</td>
                  <td data-label="Сумма" className="amount-expense">−{fmt(e.amount)}</td>
                  <td data-label=""><button className="action-btn" onClick={() => handleDelete(e.id)} title="Удалить">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
