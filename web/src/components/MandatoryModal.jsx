import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';

export default function MandatoryModal({ open, editing, onClose, onSaved, toast }) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [day, setDay] = useState('');
  const [typep, setTypep] = useState('monthly');
  const [status, setStatus] = useState('pending');

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name);
        setAmount(editing.amount);
        setCategory(editing.category);
        setDay(editing.day || '');
        setTypep(editing.type || 'monthly');
        setStatus(editing.status || 'pending');
      } else {
        setName('');
        setAmount('');
        setDay('');
        setTypep('monthly');
        setStatus('pending');
        setCategory(state.expenseCategories[0] || '');
      }
    }
  }, [open, editing, state.expenseCategories]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!name.trim()) { toast('Введите название', '#ff3b30'); return; }
    if (!amt || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    try {
      const payload = { name: name.trim(), amount: amt, category, day: parseInt(day) || null, type: typep, status };
      if (editing) await api('PUT', `/mandatory/${editing.id}`, payload);
      else await api('POST', '/mandatory', payload);
      onSaved();
      onClose();
      toast('Платёж сохранён!');
    } catch (e) {
      toast('Ошибка сохранения', '#ef4444');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{editing ? 'Изменить платёж' : 'Обязательный платёж'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Название</label>
            <input type="text" className="input-field" placeholder="Аренда, интернет..." value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Сумма (₽)</label>
            <input type="number" className="input-field" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Категория</label>
            <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {state.expenseCategories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>День списания (1–31)</label>
            <input type="number" className="input-field" placeholder="1" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Тип</label>
            <select className="input-field" value={typep} onChange={(e) => setTypep(e.target.value)}>
              <option value="monthly">Ежемесячно</option>
              <option value="once">Разово</option>
              <option value="yearly">Ежегодно</option>
            </select>
          </div>
          <div className="form-group">
            <label>Статус</label>
            <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Ожидает</option>
              <option value="paid">Оплачен</option>
            </select>
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
