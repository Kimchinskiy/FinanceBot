/* ──────────────────── Telegram Mini App SDK ──────────────────── */
if (typeof window.Telegram !== 'undefined' && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.expand();
  tg.ready();

  const theme = tg.colorScheme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  const vars = {
    '--tg-bg': '#0d0f14',
    '--tg-text': '#f0f2ff',
    '--tg-hint': '#7c85a2',
    '--tg-link': '#6366f1',
    '--tg-button': '#6366f1',
    '--tg-button-text': '#ffffff',
    '--tg-secondary-bg': '#13161e',
  };

  Object.entries(vars).forEach(([key, val]) => {
    document.documentElement.style.setProperty(key, val);
  });

  tg.MainButton.setText('➕ Добавить операцию');
  tg.MainButton.onClick(() => {
    window.dispatchEvent(new CustomEvent('tg-add-operation'));
  });
  tg.MainButton.show();

  window.__tg_close = () => tg.close();
}

export function closeTg() {
  if (typeof window.Telegram !== 'undefined' && window.Telegram.WebApp) {
    window.Telegram.WebApp.close();
  }
}
