import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, fmtDateTime } from '../utils.js';

export default function CreditCards() {
  const { toast, confirmAction } = useStore();
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [txns, setTxns] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [limitAmount, setLimitAmount] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [paymentDate, setPaymentDate] = useState('');

  const [txnModal, setTxnModal] = useState(null); // { card, type: 'purchase' | 'payment' }
  const [txnAmount, setTxnAmount] = useState('');
  const [txnDesc, setTxnDesc] = useState('');
  const [txnCategory, setTxnCategory] = useState('');

  const loadCards = async () => {
    try {
      setCards(await api('GET', '/credit-cards'));
    } catch {
      toast('Не удалось загрузить кредитки', '#ff3b30');
    }
  };

  useEffect(() => { loadCards(); }, []);

  const openForm = (card) => {
    if (card) {
      setEditing(card);
      setName(card.name);
      setLimitAmount(String(card.limit_amount));
      setClosingDate(card.closing_date || '');
      setPaymentDate(card.payment_date || '');
    } else {
      setEditing(null);
      setName('');
      setLimitAmount('');
      setClosingDate('');
      setPaymentDate('');
    }
    setShowForm(true);
  };

  const saveCard = async () => {
    if (!name.trim() || !limitAmount) { toast('Заполните название и лимит', '#ff3b30'); return; }
    try {
      const body = { name: name.trim(), limit_amount: Number(limitAmount), closing_date: closingDate ? Number(closingDate) : null, payment_date: paymentDate ? Number(paymentDate) : null };
      if (editing) await api('PUT', `/credit-cards/${editing.id}`, body);
      else await api('POST', '/credit-cards', body);
      await loadCards();
      setShowForm(false);
      toast(editing ? 'Карта обновлена' : 'Карта добавлена');
    } catch { toast('Ошибка', '#ff3b30'); }
  };

  const deleteCard = (id, cardName) => {
    confirmAction(`Удалить карту «${cardName}» и все её транзакции?`, async () => {
      try {
        await api('DELETE', `/credit-cards/${id}`);
        await loadCards();
        if (selected?.id === id) { setSelected(null); setTxns([]); }
        toast('Карта удалена');
      } catch { toast('Ошибка', '#ff3b30'); }
    });
  };

  const showTransactions = async (card) => {
    setSelected(card);
    try {
      setTxns(await api('GET', `/credit-cards/${card.id}/transactions`));
    } catch {
      toast('Не удалось загрузить операции по карте', '#ff3b30');
    }
  };

  const openTxnModal = (card, type) => {
    setTxnModal({ card, type });
    setTxnAmount('');
    setTxnDesc('');
    setTxnCategory('');
  };

  const submitTxn = async () => {
    const amt = Number(txnAmount);
    if (!txnAmount || isNaN(amt) || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    const { card, type } = txnModal;
    try {
      if (type === 'purchase') {
        await api('POST', `/credit-cards/${card.id}/purchase`, { amount: amt, description: txnDesc || '', category: txnCategory || null });
        toast('Покупка добавлена');
      } else {
        await api('POST', `/credit-cards/${card.id}/payment`, { amount: amt, description: txnDesc || 'Оплата кредитки' });
        toast('Платёж проведён');
      }
      await loadCards();
      if (selected?.id === card.id) await showTransactions(card);
      setTxnModal(null);
    } catch { toast('Ошибка', '#ff3b30'); }
  };

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" onClick={() => openForm(null)}>+ Добавить карту</button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal">
            <div className="modal-header">
              <h2>{editing ? 'Изменить карту' : 'Новая кредитная карта'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Название карты</label>
                <input type="text" className="input-field" placeholder="Тинькофф Платинум" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Кредитный лимит (₽)</label>
                <input type="number" className="input-field" placeholder="100000" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Дата закрытия (день месяца)</label>
                <input type="number" className="input-field" placeholder="15" min="1" max="31" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Дата платежа (день месяца)</label>
                <input type="number" className="input-field" placeholder="5" min="1" max="31" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setShowForm(false)}>Отмена</button>
              <button className="btn-primary" onClick={saveCard}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {txnModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setTxnModal(null); }}>
          <div className="modal">
            <div className="modal-header">
              <h2>{txnModal.type === 'purchase' ? 'Новая покупка' : 'Оплата долга'}</h2>
              <button className="modal-close" onClick={() => setTxnModal(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Сумма (₽)</label>
                <input type="number" className="input-field" placeholder="0.00" autoFocus value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Описание (необязательно)</label>
                <input type="text" className="input-field" placeholder="Краткое описание" value={txnDesc} onChange={(e) => setTxnDesc(e.target.value)} />
              </div>
              {txnModal.type === 'purchase' && (
                <div className="form-group">
                  <label>Категория (необязательно)</label>
                  <input type="text" className="input-field" placeholder="Например, Еда" value={txnCategory} onChange={(e) => setTxnCategory(e.target.value)} />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setTxnModal(null)}>Отмена</button>
              <button className="btn-primary" onClick={submitTxn}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="empty-state">Нет кредитных карт. Добавьте первую!</div>
      ) : (
        <div className="credit-cards-list">
          {cards.map(c => {
            const usagePct = c.limit_amount > 0 ? Math.round((c.balance / c.limit_amount) * 100) : 0;
            return (
              <div key={c.id} className={`credit-card ${selected?.id === c.id ? 'selected' : ''} ${c.balance <= 0 ? 'paid-card' : ''}`} onClick={() => showTransactions(c)}>
                <div className="credit-card-header">
                  <div className="credit-card-name">{c.name}</div>
                  <div className="credit-card-actions">
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); openForm(c); }} title="Изменить" aria-label="Изменить">✎</button>
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); deleteCard(c.id, c.name); }} title="Удалить" aria-label="Удалить">🗑</button>
                  </div>
                </div>
                <div className="credit-card-limit">Лимит: {fmt(c.limit_amount)}</div>
                <div className="credit-card-balance">{c.balance > 0 ? fmt(c.balance) : 'Погашена'}</div>
                <div className="credit-card-bar-bg">
                  <div className="credit-card-bar-fill" style={{ width: Math.min(usagePct, 100) + '%' }}></div>
                </div>
                <div className="credit-card-actions-row">
                  <button className="btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); openTxnModal(c, 'payment'); }}>💳 Оплатить</button>
                  <button className="btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openTxnModal(c, 'purchase'); }}>➕ Покупка</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <span>История: {selected.name}</span>
            <button className="action-btn" onClick={() => { setSelected(null); setTxns([]); }} title="Закрыть" aria-label="Закрыть">✕</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th><th>Тип</th><th>Категория</th><th>Описание</th><th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan="5" className="empty-cell">Нет операций</td></tr>
                ) : txns.map(t => (
                  <tr key={t.id}>
                    <td data-label="Дата">{fmtDateTime(t.datetime)}</td>
                    <td data-label="Тип">
                      <span className={`src-badge ${t.type === 'purchase' ? 'badge-expense' : 'badge-income'}`}>
                        {t.type === 'purchase' ? 'Покупка' : 'Оплата'}
                      </span>
                    </td>
                    <td data-label="Категория">{t.category || '—'}</td>
                    <td data-label="Описание">{t.description || '—'}</td>
                    <td data-label="Сумма" className={t.type === 'purchase' ? 'amount-expense' : 'amount-income'}>
                      {t.type === 'purchase' ? '−' : '+'}{fmt(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
