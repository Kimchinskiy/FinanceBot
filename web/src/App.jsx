import { useCallback, useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
import { api } from './api.js';
import { closeTg } from './telegram.js';
import { Toast } from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import QuickAddModal from './components/QuickAddModal.jsx';
import MandatoryModal from './components/MandatoryModal.jsx';
import DebtModal from './components/DebtModal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Operations from './pages/Operations.jsx';
import Mandatory from './pages/Mandatory.jsx';
import Assets from './pages/Assets.jsx';
import Debts from './pages/Debts.jsx';
import Analytics from './pages/Analytics.jsx';
import Settings from './pages/Settings.jsx';
import CreditCards from './pages/CreditCards.jsx';
import ChatAI from './pages/ChatAI.jsx';
import TelegramLoginButton from './components/TelegramLoginButton.jsx';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from './components/NavigationMenu.jsx';

const TITLES = {
  dashboard: 'Обзор', operations: 'Операции',
  mandatory: 'Обязательные платежи', creditcards: 'Кредитки', assets: 'Накопления', debts: 'Долги', analytics: 'Аналитика', chat: 'AI-помощник', settings: 'Настройки'
};

function AppInner() {
  const { token, state, login, register, logout, startApp, reload, loginTelegram, toast, toasts, dismissToast, confirmState, resolveConfirm } = useStore();
  const [page, setPage] = useState('dashboard');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickType, setQuickType] = useState('expense');
  const [quickEdit, setQuickEdit] = useState(null);
  const [mandOpen, setMandOpen] = useState(false);
  const [mandEditing, setMandEditing] = useState(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const [debtEditing, setDebtEditing] = useState(null);

  const openQuickAdd = (type) => { setQuickType(type); setQuickEdit(null); setQuickOpen(true); };
  const openQuickEdit = (item) => { setQuickEdit(item); setQuickOpen(true); };
  const openMandatory = (m) => { setMandEditing(m || null); setMandOpen(true); };
  const openDebt = (d) => { setDebtEditing(d || null); setDebtOpen(true); };

  const navigate = (p) => setPage(p);

  useEffect(() => {
    if (token) startApp();
  }, [token, startApp]);

  // Telegram MainButton
  useEffect(() => {
    const handler = () => openQuickAdd('expense');
    window.addEventListener('tg-add-operation', handler);
    return () => window.removeEventListener('tg-add-operation', handler);
  }, []);

  // Delegated clicks для data-nav / data-action
  useEffect(() => {
    const handler = (e) => {
      const navEl = e.target.closest('[data-nav]');
      if (navEl) { navigate(navEl.dataset.nav); return; }
      const actEl = e.target.closest('[data-action]');
      if (actEl) {
        const a = actEl.dataset.action;
        if (a === 'add-income') openQuickAdd('income');
        if (a === 'add-expense') openQuickAdd('expense');
        if (a === 'add-mandatory') openMandatory(null);
        if (a === 'add-debt') openDebt(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  if (!token) {
    return <AuthScreen
      onAuth={async (fields, mode) => {
        if (mode === 'register') await register(fields.email, fields.password, fields.username);
        else await login(fields.identifier, fields.password);
      }}
      onTelegram={async (user) => { await loginTelegram(user); }} />;
  }

  return (
    <>
      <nav className="navbar">
        <NavigationMenu className="navbar-nav desktop-nav">
          <NavigationMenuList>
            {NAV_ITEMS.map(p => (
              <NavigationMenuItem key={p.id}>
                <NavigationMenuLink
                  className={`nav-item ${page === p.id ? 'active' : ''} ${navigationMenuTriggerStyle()}`}
                  onClick={(e) => { e.preventDefault(); navigate(p.id); }}
                >
                  <span className="nav-ico">{NAV_ICONS[p.id]}</span><span className="nav-txt">{p.label}</span>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="navbar-actions">
          <button className="btn-primary" onClick={() => openQuickAdd('expense')}>+ Добавить</button>
        </div>
      </nav>

      <button className="fab" onClick={() => openQuickAdd('expense')} aria-label="Добавить операцию">+</button>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">{TITLES[page]}</div>
          <div className="topbar-actions">
            <button className="btn-close-tg" onClick={closeTg} title="Закрыть" aria-label="Закрыть" style={{ display: 'none' }} id="close-tg-btn">✕</button>
          </div>
        </header>

        <div className="page active" key={page}>
          {page === 'dashboard' && <Dashboard />}
          {page === 'operations' && <Operations onEdit={openQuickEdit} />}
           {page === 'mandatory' && <Mandatory onEdit={openMandatory} />}
           {page === 'creditcards' && <CreditCards />}
           {page === 'assets' && <Assets />}
           {page === 'debts' && <Debts onEdit={openDebt} />}
          {page === 'analytics' && <Analytics />}
          {page === 'chat' && <ChatAI />}
           {page === 'settings' && <Settings />}
        </div>
      </main>

      <QuickAddModal open={quickOpen} type={quickType} editing={quickEdit}
        onClose={() => setQuickOpen(false)}
        onSaved={() => { reload('incomes'); reload('expenses'); reload('accounts'); }}
        toast={toast} />

      <NavigationMenu className="navbar-nav mobile-tabbar" aria-label="Навигация">
        <NavigationMenuList>
          {NAV_ITEMS.map(p => (
            <NavigationMenuItem key={p.id}>
              <NavigationMenuLink
                className={`nav-item ${page === p.id ? 'active' : ''} ${navigationMenuTriggerStyle()}`}
                onClick={(e) => { e.preventDefault(); navigate(p.id); }}
              >
                <span className="nav-ico">{NAV_ICONS[p.id]}</span><span className="nav-txt">{p.label}</span>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>

      <MandatoryModal open={mandOpen} editing={mandEditing}
        onClose={() => setMandOpen(false)}
        onSaved={() => reload('mandatory')}
        toast={toast} />

      <DebtModal open={debtOpen} editing={debtEditing}
        onClose={() => setDebtOpen(false)}
        onSaved={() => reload('debts')}
        toast={toast} />

      <ConfirmDialog open={!!confirmState} text={confirmState?.text}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)} />

      {toasts.map(t => (
        <Toast key={t.id} message={t.msg} color={t.color} onDone={() => dismissToast(t.id)} />
      ))}
    </>
  );
}

const NAV_ICONS = { dashboard: '🏠', income: '📈', expenses: '📉', operations: '💱', mandatory: '📅', creditcards: '💳', assets: '💎', debts: '🤝', analytics: '📊', chat: '🧠', settings: '⚙️' };

// Плоский порядок пунктов меню
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'operations', label: 'Операции' },
  { id: 'debts', label: 'Долги' },
  { id: 'mandatory', label: 'Платежи' },
  { id: 'creditcards', label: 'Кредитки' },
  { id: 'assets', label: 'Накопления' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'chat', label: 'AI' },
  { id: 'settings', label: 'Ещё' },
];

function AuthScreen({ onAuth, onTelegram }) {
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [allowRegister, setAllowRegister] = useState(true);
  const [tgLoading, setTgLoading] = useState(false);

  useEffect(() => {
    api('GET', '/auth/config').then(cfg => {
      if (!cfg.allowRegister) { setAllowRegister(false); setMode('login'); }
    }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'register') {
        await onAuth({ email: email.trim(), username: username.trim(), password }, mode);
      } else {
        await onAuth({ identifier: identifier.trim(), password }, mode);
      }
    } catch (err) {
      setError(err.message === 'unauthorized' ? 'Неверный логин или пароль' : (err.message || 'Ошибка входа'));
    }
  };

  const handleTelegram = useCallback(async (user) => {
    setTgLoading(true);
    setError('');
    try {
      const res = await onTelegram(user);
      if (res && res.error) setError(res.error);
    } catch (err) {
      setError(err.message || 'Ошибка входа через Telegram');
    } finally {
      setTgLoading(false);
    }
  }, [onTelegram]);

  return (
    <div className="auth-screen" style={{ display: 'flex' }}>
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon">💰</div>
          <span className="logo-text">FinanceBot</span>
        </div>
        <p className="auth-sub">Войдите, чтобы продолжить</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'login' ? (
            <div className="form-group">
              <label htmlFor="auth-identifier">Email или логин</label>
              <input id="auth-identifier" name="identifier" type="text" className="input-field" placeholder="you@example.com или логин" required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="auth-email">Email</label>
                <input id="auth-email" name="email" type="email" className="input-field" placeholder="you@example.com" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="auth-username">Логин (необязательно)</label>
                <input id="auth-username" name="username" type="text" className="input-field" placeholder="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            </>
          )}
          <div className="form-group">
            <label htmlFor="auth-password">Пароль</label>
            <input id="auth-password" name="password" type="password" className="input-field" placeholder="••••••" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary auth-submit">{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </form>
        <div className="auth-divider"><span>или</span></div>
        <TelegramLoginButton onAuth={handleTelegram} />
        {tgLoading && <p className="auth-error">Вход через Telegram…</p>}
        <p className="auth-error">{error}</p>
        {allowRegister && (
          <p className="auth-switch">
            <span>{mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}</span>
            <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</a>
          </p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  );
}
