import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { now } from '../utils.js';

export default function QuickAddModal({ open, type, onClose, onSaved, toast }) {
  const { state } = useStore();
  const [modalType, setModalType] = useState(type || 'expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('Наличные');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(now());

  useEffect(() => {
    if (open) {
      setModalType(type || 'expense');
      setAmount('');
      setDesc('');
      setDate(now());
      setSource('Наличные');
      const cats = (type || 'expense') === 'income' ? state.incomeCategories : state.expenseCategories;
      setCategory(cats[0] || '');
    }
  }, [open, type, state.incomeCategories, state.expenseCategories]);

  const cats = modalType === 'income' ? state.incomeCategories : state.expenseCategories;

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    try {
      if (modalType === 'income') {
        await api('POST', '/incomes', { amount: amt, category, description: desc, datetime: date, source });
      } else {
        await api('POST', '/expenses', { amount: amt, category, description: desc, datetime: date, source });
      }
      onSaved();
      onClose();
      toast(`${modalType === 'income' ? 'Доход' : 'Расход'} добавлен!`);
    } catch (e) {
      toast('Ошибка сохранения', '#ff3b30');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Добавить операцию</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-tabs" id="modal-tabs">
            <button className={`tab-btn ${modalType === 'expense' ? 'active' : ''}`} onClick={() => { setModalType('expense'); setCategory(state.expenseCategories[0] || ''); }}>📉 Расход</button>
            <button className={`tab-btn ${modalType === 'income' ? 'active' : ''}`} onClick={() => { setModalType('income'); setCategory(state.incomeCategories[0] || ''); }}>📈 Доход</button>
          </div>
          <div className="form-group">
            <label>Сумма (₽)</label>
            <input type="number" className="input-field" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Категория</label>
            <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Счёт (откуда/куда)</label>
            <div className="source-toggle" role="tablist">
              <button type="button" className={`source-opt ${source === 'Наличные' ? 'active' : ''}`} onClick={() => setSource('Наличные')}>💵 Наличные</button>
              <button type="button" className={`source-opt ${source === 'Карта' ? 'active' : ''}`} onClick={() => setSource('Карта')}>💳 Безнал</button>
              <span className="source-thumb" aria-hidden="true"></span>
            </div>
          </div>
          <div className="form-group">
            <label>Описание (необязательно)</label>
            <input type="text" className="input-field" placeholder="Краткое описание" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Дата и время</label>
            <input type="datetime-local" className="input-field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}
