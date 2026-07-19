import { useEffect, useRef } from 'react';

// Официальный Telegram Login Widget.
// username — @username бота (без @). onAuth(user) вызывается при успехе.
export default function TelegramLoginButton({ username = 'fiiinaaanceee_bot', onAuth, buttonSize = 'large' }) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = '';

    // Глобальный колбэк, который вызывает виджет
    const cbName = '__tgLoginCb_' + Math.random().toString(36).slice(2);
    window[cbName] = (user) => { onAuth && onAuth(user); delete window[cbName]; };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', username);
    script.setAttribute('data-size', buttonSize);
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-onauth', `${cbName}(user)`);
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete window[cbName];
    };
  }, [username, buttonSize, onAuth]);

  return <div ref={ref} className="tg-login-btn" />;
}
