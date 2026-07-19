import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, fmtDate, debtDirectionLabel } from '../utils.js';

export default function Debts({ onEdit, onDelete }) {
  const { state, reload } = useStore();

  const handleDelete = async (id) => {
    await api('DELETE', `/debts/${id}`);
    await reload('debts');
    onDelete();
  };
  const handleToggle = async (id) => {
    await api('PATCH', `/debts/${id}/toggle`);
    await reload('debts');
  };

  const debts = state.debts || [];
  const iOwe = debts.filter(d => d.direction === 'i_owe' && d.status !== 'paid');
  const oweMe = debts.filter(d => d.direction === 'owe_me' && d.status !== 'paid');
  const totalIOwe = iOwe.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalOweMe = oweMe.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const Row = ({ d }) => (
    <div key={d.id} className={`debt-card ${d.status === 'paid' ? 'paid-card' : ''} dir-${d.direction}`}>
      <div className="dc-header">
        <div className="dc-person">{d.person}</div>
        <div className="mc-actions">
          <button className="action-btn" onClick={() => onEdit(d)} title="Изменить">✎</button>
          <button className="action-btn" onClick={() => handleDelete(d.id)} title="Удалить">🗑</button>
        </div>
      </div>
      <div className={`dc-amount ${d.direction}`}>{fmt(d.amount)}</div>
      <div className="mc-meta">
        <span className="mc-chip">{debtDirectionLabel(d.direction)}</span>
        {d.due_date && <span className="mc-chip">до {fmtDate(d.due_date)}</span>}
        {d.note && <span className="mc-chip">{d.note}</span>}
      </div>
      <button className={`mc-status-btn ${d.status === 'paid' ? 'mark-unpaid' : 'mark-paid'}`} onClick={() => handleToggle(d.id)}>
        {d.status === 'paid' ? '↩ Вернуть в долги' : '✓ Отметить закрытым'}
      </button>
    </div>
  );

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" data-action="add-debt">+ Добавить долг</button>
      </div>

      <div className="debts-summary">
        <div className="ds-card negative"><div className="ds-label">Я должен</div><div className="ds-value">{fmt(totalIOwe)}</div></div>
        <div className="ds-card positive"><div className="ds-label">Мне должны</div><div className="ds-value">{fmt(totalOweMe)}</div></div>
      </div>

      {debts.length === 0 ? (
        <div className="empty-state">Нет долгов. Добавьте первый!</div>
      ) : (
        <>
          {iOwe.length > 0 && (
            <div className="debt-section">
              <div className="debt-section-title">📤 Я должен</div>
              <div className="mandatory-cards">{iOwe.map(d => <Row key={d.id} d={d} />)}</div>
            </div>
          )}
          {oweMe.length > 0 && (
            <div className="debt-section">
              <div className="debt-section-title">📥 Мне должны</div>
              <div className="mandatory-cards">{oweMe.map(d => <Row key={d.id} d={d} />)}</div>
            </div>
          )}
          {debts.some(d => d.status === 'paid') && (
            <div className="debt-section">
              <div className="debt-section-title">✓ Закрытые</div>
              <div className="mandatory-cards">{debts.filter(d => d.status === 'paid').map(d => <Row key={d.id} d={d} />)}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
