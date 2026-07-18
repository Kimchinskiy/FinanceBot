import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, typeLabel } from '../utils.js';

export default function Mandatory({ onEdit, onDelete }) {
  const { state, reload } = useStore();

  const handleDelete = async (id) => {
    await api('DELETE', `/mandatory/${id}`);
    await reload('mandatory');
    onDelete();
  };
  const handleToggle = async (id) => {
    await api('PATCH', `/mandatory/${id}/toggle`);
    await reload('mandatory');
  };

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" data-action="add-mandatory">+ Добавить платёж</button>
      </div>
      <div className="mandatory-cards">
        {state.mandatory.length === 0 ? (
          <div className="empty-state">Нет обязательных платежей. Добавьте первый!</div>
        ) : state.mandatory.map(m => (
          <div key={m.id} className={`mandatory-card ${m.status === 'paid' ? 'paid-card' : ''}`}>
            <div className="mc-header">
              <div className="mc-name">{m.name}</div>
              <div className="mc-actions">
                <button className="action-btn" onClick={() => onEdit(m)} title="Изменить">✎</button>
                <button className="action-btn" onClick={() => handleDelete(m.id)} title="Удалить">🗑</button>
              </div>
            </div>
            <div className="mc-amount">{fmt(m.amount)}</div>
            <div className="mc-meta">
              <span className="mc-chip">{m.category}</span>
              <span className="mc-chip">{typeLabel(m.type)}</span>
              {m.day && <span className="mc-chip">{m.day} числа</span>}
            </div>
            <button className={`mc-status-btn ${m.status === 'paid' ? 'mark-unpaid' : 'mark-paid'}`} onClick={() => handleToggle(m.id)}>
              {m.status === 'paid' ? '↩ Отметить неоплаченным' : '✓ Отметить оплаченным'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
