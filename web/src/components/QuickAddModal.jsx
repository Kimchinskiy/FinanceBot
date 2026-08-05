import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { now, suggestCategory } from '../utils.js';

export default function QuickAddModal({ open, type, editing, onClose, onSaved, toast }) {
  const { state } = useStore();
  const [modalType, setModalType] = useState(type || 'expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('Карта');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(now());
  const [saving, setSaving] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setModalType(editing.kind);
        setAmount(String(editing.amount));
        setCategory(editing.category || '');
        setSource(editing.source || 'Карта');
        setDesc(editing.description || '');
        setDate(editing.datetime ? editing.datetime.slice(0, 16) : now());
        setCategoryTouched(true);
      } else {
        setModalType(type || 'expense');
        setAmount('');
        setDesc('');
        setDate(now());
        setSource('Карта');
        const cats = (type || 'expense') === 'income' ? state.incomeCategories : state.expenseCategories;
        setCategory(cats[0] || '');
        setCategoryTouched(false);
      }
    }
  }, [open, type, editing, state.incomeCategories, state.expenseCategories]);

  const cats = modalType === 'income' ? state.incomeCategories : state.expenseCategories;
  const isEdit = !!editing;

  // Автоподсказка категории по истории: описание в приоритете, иначе — близкая сумма.
  // Не трогаем категорию, если пользователь уже выбрал её сам, и не работаем в режиме редактирования.
  useEffect(() => {
    if (!open || isEdit || categoryTouched) return;
    const t = setTimeout(() => {
      const entries = modalType === 'income' ? state.incomes : state.expenses;
      const suggestion = suggestCategory(entries, { description: desc, amount });
      if (suggestion && cats.includes(suggestion) && suggestion !== category) {
        setCategory(suggestion);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desc, amount, modalType, open]);

  const save = async () => {
    if (saving) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    setSaving(true);
    try {
      const body = { amount: amt, category, description: desc, datetime: date, source };
      if (isEdit) {
        const path = modalType === 'income' ? `/incomes/${editing.id}` : `/expenses/${editing.id}`;
        await api('PUT', path, body);
        toast(`${modalType === 'income' ? 'Доход' : 'Расход'} изменён!`);
      } else {
        if (modalType === 'income') {
          await api('POST', '/incomes', body);
        } else {
          await api('POST', '/expenses', body);
        }
        toast(`${modalType === 'income' ? 'Доход' : 'Расход'} добавлен!`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast('Ошибка сохранения', '#ff3b30');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Изменить операцию' : 'Добавить операцию'}</h2>
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
            <select className="input-field" value={category} onChange={(e) => { setCategory(e.target.value); setCategoryTouched(true); }}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Счёт (откуда/куда)</label>
              <div className={`source-toggle ${source === 'Карта' ? 'is-card' : ''}`} role="tablist">
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
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Сохранить')}</button>
        </div>
      </div>
    </div>
  );
}
