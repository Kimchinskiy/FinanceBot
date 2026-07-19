import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function DebtModal({ open, editing, onClose, onSaved, toast }) {
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('i_owe');
  const [status, setStatus] = useState('pending');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      if (editing) {
        setPerson(editing.person);
        setAmount(editing.amount);
        setDirection(editing.direction || 'i_owe');
        setStatus(editing.status || 'pending');
        setDueDate(editing.due_date || '');
        setNote(editing.note || '');
      } else {
        setPerson('');
        setAmount('');
        setDirection('i_owe');
        setStatus('pending');
        setDueDate('');
        setNote('');
      }
    }
  }, [open, editing]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!person.trim()) { toast('Введите имя / кого', '#ff3b30'); return; }
    if (!amt || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    try {
      const payload = {
        person: person.trim(), amount: amt, direction,
        status, due_date: dueDate || null, note: note.trim(),
      };
      if (editing) await api('PUT', `/debts/${editing.id}`, payload);
      else await api('POST', '/debts', payload);
      onSaved();
      onClose();
      toast('Долг сохранён!');
    } catch (e) {
      toast('Ошибка сохранения', '#ef4444');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{editing ? 'Изменить долг' : 'Новый долг'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Кто</label>
            <input type="text" className="input-field" placeholder="Имя, кого касается долг" value={person} onChange={(e) => setPerson(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Сумма (₽)</label>
            <input type="number" className="input-field" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Тип</label>
            <select className="input-field" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="i_owe">Я должен</option>
              <option value="owe_me">Мне должны</option>
            </select>
          </div>
          <div className="form-group">
            <label>Срок (необязательно)</label>
            <input type="date" className="input-field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Заметка</label>
            <input type="text" className="input-field" placeholder="Комментарий" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Статус</label>
            <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Активен</option>
              <option value="paid">Закрыт</option>
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
