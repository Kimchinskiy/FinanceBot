import { useEffect, useRef, useState } from 'react';

export function Toast({ message, color = '#34c759', onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    const t1 = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2500);
    const t2 = setTimeout(() => onDone && onDone(), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
        background: '#1d1d1f', color: '#ffffff', padding: '13px 26px',
        borderRadius: '980px', fontSize: '14px', fontWeight: '500',
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)', zIndex: 9999,
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', opacity: 0,
        maxWidth: '90vw', textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = (msg, color) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, color }]);
  };
  const remove = (id) => setToasts(t => t.filter(x => x.id !== id));
  return {
    toasts,
    show,
    ToastContainer: () => (
      <>
        {toasts.map(t => (
          <Toast key={t.id} message={t.msg} color={t.color} onDone={() => remove(t.id)} />
        ))}
      </>
    ),
  };
}
