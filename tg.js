/* ──────────────────── Telegram Mini App SDK ──────────────────── */
(function() {
  if (typeof window.Telegram === 'undefined' || !window.Telegram.WebApp) {
    console.log('ℹ️ Not running inside Telegram');
    return;
  }

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

  tg.onEvent('themeChanged', () => { });

  tg.MainButton.setText('➕ Добавить операцию');
  tg.MainButton.onClick(() => {
    if (typeof openQuickAdd === 'function') {
      openQuickAdd('expense');
    }
  });
  tg.MainButton.show();

  const origError = window.onerror;
  window.onerror = function(msg) {
    tg.showAlert('Произошла ошибка. Пожалуйста, попробуйте снова.');
    if (origError) origError.apply(this, arguments);
  };

  window.__tg_close = () => tg.close();

  const urlParams = new URLSearchParams(window.location.search);
  const pageParam = urlParams.get('page');
  if (pageParam && ['income','expenses','mandatory','analytics','settings'].includes(pageParam)) {
    document.addEventListener('DOMContentLoaded', () => navigate(pageParam));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('close-tg-btn');
    if (closeBtn) {
      closeBtn.style.display = '';
      closeBtn.addEventListener('click', () => tg.close());
    }
  });
})();
