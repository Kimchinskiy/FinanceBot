import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
import { api } from './api.js';
import { closeTg } from './telegram.js';
import { useToast } from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import QuickAddModal from './components/QuickAddModal.jsx';
import MandatoryModal from './components/MandatoryModal.jsx';
import DebtModal from './components/DebtModal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Incomes from './pages/Incomes.jsx';
import Expenses from './pages/Expenses.jsx';
import Mandatory from './pages/Mandatory.jsx';
import Assets from './pages/Assets.jsx';
import Debts from './pages/Debts.jsx';
import Analytics from './pages/Analytics.jsx';
import Settings from './pages/Settings.jsx';
import TelegramLoginButton from './components/TelegramLoginButton.jsx';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuTrigger,
  NavigationMenuContent,
  navigationMenuTriggerStyle,
} from './components/NavigationMenu.jsx';

const TITLES = {
  dashboard: 'Обзор', income: 'Доходы', expenses: 'Расходы',
  mandatory: 'Обязательные платежи', assets: 'Активы', debts: 'Долги', analytics: 'Аналитика', settings: 'Настройки'
};

function AppInner() {
  const { token, state, login, register, logout, startApp, reload, loginTelegram } = useStore();
  const { toasts, show, ToastContainer } = useToast();
  const [page, setPage] = useState('dashboard');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickType, setQuickType] = useState('expense');
  const [mandOpen, setMandOpen] = useState(false);
  const [mandEditing, setMandEditing] = useState(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const [debtEditing, setDebtEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const toast = show;

  const openQuickAdd = (type) => { setQuickType(type); setQuickOpen(true); };
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
      onAuth={async (email, password, mode) => {
        if (mode === 'register') await register(email, password);
        else await login(email, password);
      }}
      onTelegram={async (user) => { await loginTelegram(user); }}
      ToastContainer={ToastContainer} toast={toast} />;
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">
          <div className="logo-icon">💰</div>
          <span className="logo-text">FinanceBot</span>
        </div>
        <NavigationMenu className="navbar-nav">
          <NavigationMenuList>
            {NAV_DIRECT.map(p => (
              <NavigationMenuItem key={p.id}>
                <NavigationMenuLink
                  className={`nav-item ${page === p.id ? 'active' : ''} ${navigationMenuTriggerStyle()}`}
                  onClick={(e) => { e.preventDefault(); navigate(p.id); }}
                >
                  <span className="nav-ico">{NAV_ICONS[p.id]}</span><span className="nav-txt">{p.label}</span>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
            <NavigationMenuItem>
              <NavigationMenuTrigger className={`nav-item ${NAV_GROUP.items.some(i => i.id === page) ? 'active' : ''}`}>
                <span className="nav-ico">💼</span><span className="nav-txt">{NAV_GROUP.label}</span>
              </NavigationMenuTrigger>
              <NavigationMenuContent className="nav-dropdown">
                {NAV_GROUP.items.map(i => (
                  <NavigationMenuLink
                    key={i.id}
                    className={`nav-dropdown-link ${page === i.id ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); navigate(i.id); }}
                  >
                    <span className="nav-ico">{NAV_ICONS[i.id]}</span>
                    <span>{i.label}</span>
                  </NavigationMenuLink>
                ))}
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <NavigationMenu className="mobile-nav">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger className="mobile-nav-trigger">☰<span>Меню</span></NavigationMenuTrigger>
              <NavigationMenuContent className="mobile-nav-panel">
                {NAV_ALL.map(i => (
                  <NavigationMenuLink
                    key={i.id}
                    className={`mobile-nav-link ${page === i.id ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); navigate(i.id); }}
                  >
                    <span className="nav-ico">{NAV_ICONS[i.id]}</span>
                    <span>{i.label}</span>
                  </NavigationMenuLink>
                ))}
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="navbar-actions">
          <button className="btn-primary" onClick={() => openQuickAdd('expense')}>+ Добавить</button>
          <button className="btn-outline" onClick={logout}>Выйти</button>
        </div>
      </nav>

      <button className="fab" onClick={() => openQuickAdd('expense')} aria-label="Добавить операцию">+</button>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">{TITLES[page]}</div>
          <div className="topbar-actions">
            <button className="btn-close-tg" onClick={closeTg} title="Закрыть" style={{ display: 'none' }} id="close-tg-btn">✕</button>
          </div>
        </header>

        <div className="page active" key={page}>
          {page === 'dashboard' && <Dashboard />}
          {page === 'income' && <Incomes onDelete={() => toast('Удалено')} />}
          {page === 'expenses' && <Expenses onDelete={() => toast('Удалено')} />}
           {page === 'mandatory' && <Mandatory onEdit={openMandatory} onDelete={() => toast('Удалено')} />}
           {page === 'assets' && <Assets toast={toast} />}
           {page === 'debts' && <Debts onEdit={openDebt} onDelete={() => toast('Удалено')} />}
           {page === 'analytics' && <Analytics />}
          {page === 'settings' && <Settings toast={toast} />}
        </div>
      </main>

      <QuickAddModal open={quickOpen} type={quickType}
        onClose={() => setQuickOpen(false)}
        onSaved={() => { reload('incomes'); reload('expenses'); reload('accounts'); }}
        toast={toast} />

      <MandatoryModal open={mandOpen} editing={mandEditing}
        onClose={() => setMandOpen(false)}
        onSaved={() => reload('mandatory')}
        toast={toast} />

      <DebtModal open={debtOpen} editing={debtEditing}
        onClose={() => setDebtOpen(false)}
        onSaved={() => reload('debts')}
        toast={toast} />

      <ConfirmDialog open={!!confirm} text={confirm?.text}
        onConfirm={() => { confirm?.cb(); setConfirm(null); }}
        onCancel={() => setConfirm(null)} />

      <ToastContainer />
    </>
  );
}

const NAV_ICONS = { dashboard: '🏠', income: '📈', expenses: '📉', mandatory: '📅', assets: '💎', debts: '🤝', analytics: '📊', settings: '⚙️' };

// Группировка пунктов меню для NavigationMenu (desktop: dropdown, mobile: единая панель)
const NAV_DIRECT = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'settings', label: 'Настройки' },
];
const NAV_GROUP = {
  label: 'Финансы',
  items: [
    { id: 'income', label: 'Доходы' },
    { id: 'expenses', label: 'Расходы' },
    { id: 'mandatory', label: 'Обязательные платежи' },
    { id: 'debts', label: 'Долги' },
    { id: 'assets', label: 'Активы' },
  ],
};
const NAV_ALL = [...NAV_DIRECT, ...NAV_GROUP.items];

function AuthScreen({ onAuth, onTelegram, toast }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
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
      await onAuth(email.trim(), password, mode);
    } catch (err) {
      setError(err.message === 'unauthorized' ? 'Неверный email или пароль' : (err.message || 'Ошибка входа'));
    }
  };

  const handleTelegram = async (user) => {
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
  };

  return (
    <div className="auth-screen" style={{ display: 'flex' }}>
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon">💰</div>
          <span className="logo-text">FinanceBot</span>
        </div>
        <p className="auth-sub">Войдите, чтобы продолжить</p>
        <form className="auth-form" onSubmit={submit} autoComplete="off">
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="input-field" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input type="password" className="input-field" placeholder="••••••" required value={password} onChange={(e) => setPassword(e.target.value)} />
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
