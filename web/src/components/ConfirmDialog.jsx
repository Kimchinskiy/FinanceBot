import { useEffect } from 'react';

export default function ConfirmDialog({ open, text, onConfirm, onCancel }) {
  useEffect(() => {
    const handler = (e) => {
      if (!open) return;
      if (e.key === 'Escape') onCancel && onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel && onCancel(); }}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>Подтверждение</h2>
        </div>
        <div className="modal-body">
          <p id="confirm-text">{text}</p>
        </div>
        <div className="modal-footer">
          <button className="btn-outline" onClick={onCancel}>Отмена</button>
          <button className="btn-danger" onClick={onConfirm}>Удалить</button>
        </div>
      </div>
    </div>
  );
}
