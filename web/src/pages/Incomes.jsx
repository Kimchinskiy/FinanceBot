import { useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, fmtDateTime, getCategoryColor, sourceLabel } from '../utils.js';

function populateMonths(data) {
  return [...new Set(data.map(d => d.datetime.slice(0, 7)))].sort().reverse();
}

export default function Incomes({ onDelete }) {
  const { state, reload } = useStore();
  const [month, setMonth] = useState('');
  const [cat, setCat] = useState('');

  const months = populateMonths(state.incomes);
  let data = [...state.incomes].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  if (month) data = data.filter(i => i.datetime.startsWith(month));
  if (cat) data = data.filter(i => i.category === cat);

  const handleDelete = async (id) => {
    await api('DELETE', `/incomes/${id}`);
    await reload('incomes');
    onDelete();
  };

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" data-action="add-income">+ Добавить доход</button>
      </div>
      <div className="panel">
        <div className="panel-header">
          <span>Все доходы</span>
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
              {state.incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
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
                <tr><td colSpan="6" className="empty-cell">Нет доходов</td></tr>
              ) : data.map(i => (
                <tr key={i.id} className="tx-row-mobile">
                  <td data-label="Дата">{fmtDateTime(i.datetime)}</td>
                  <td data-label="Категория"><span className="cat-badge" style={{ background: getCategoryColor(i.category) + '22', color: getCategoryColor(i.category) }}>{i.category}</span></td>
                  <td data-label="Счёт"><span className="src-badge">{sourceLabel(i.source)}</span></td>
                  <td data-label="Описание">{i.description || '—'}</td>
                  <td data-label="Сумма" className="amount-income">+{fmt(i.amount)}</td>
                  <td data-label=""><button className="action-btn" onClick={() => handleDelete(i.id)} title="Удалить">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
