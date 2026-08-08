import { isDaytimeVladivostok } from './utils.js';

const KEY = 'themeMode'; // 'auto' | 'light' | 'dark'

export function getThemeMode() {
  return localStorage.getItem(KEY) || 'auto';
}

export function applyTheme() {
  const mode = getThemeMode();
  const effective = mode === 'auto' ? (isDaytimeVladivostok() ? 'light' : 'dark') : mode;
  document.documentElement.setAttribute('data-theme', effective);
}

export function setThemeMode(mode) {
  localStorage.setItem(KEY, mode);
  applyTheme();
}

let _timer = null;

// Применяет тему сразу и переодически пересчитывает авто-режим,
// чтобы подхватить переход через 6:00/18:00 пока приложение открыто.
export function initTheme() {
  applyTheme();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(applyTheme, 5 * 60 * 1000);
}
