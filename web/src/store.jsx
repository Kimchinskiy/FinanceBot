import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setSession, clearToken } from './api.js';
import { DEFAULT_INCOME_CATS, DEFAULT_EXPENSE_CATS } from './utils.js';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [token, setTokenState] = useState(getToken());
  const [user, setUserState] = useState(null);
  const [state, setState] = useState({
    incomes: [],
    expenses: [],
    mandatory: [],
    debts: [],
    accounts: [],
    salary: { day: null, amount: 0, period: 'monthly' },
    incomeCategories: [...DEFAULT_INCOME_CATS],
    expenseCategories: [...DEFAULT_EXPENSE_CATS],
  });
  const [loading, setLoading] = useState(false);
  const [quotesConfig, setQuotesConfig] = useState({ crypto: true, stocks: false });

  const loadAll = useCallback(async () => {
    try {
      const [incomes, expenses, mandatory, debts, settings, accounts] = await Promise.all([
        api('GET', '/incomes'),
        api('GET', '/expenses'),
        api('GET', '/mandatory'),
        api('GET', '/debts'),
        api('GET', '/settings'),
        api('GET', '/accounts'),
      ]);
      setState(prev => ({
        ...prev,
        incomes,
        expenses,
        accounts: accounts || [],
        debts: (debts || []).map(d => ({ ...d, amount: parseFloat(d.amount) })),
        mandatory: mandatory.map(m => ({ ...m, amount: parseFloat(m.amount) })),
        salary: settings.salary
          ? (typeof settings.salary === 'string' ? JSON.parse(settings.salary) : settings.salary)
          : prev.salary,
        incomeCategories: settings.income_categories
          ? ((typeof settings.income_categories === 'string'
              ? JSON.parse(settings.income_categories)
              : settings.income_categories).length
              ? (typeof settings.income_categories === 'string'
                  ? JSON.parse(settings.income_categories)
                  : settings.income_categories)
              : [...DEFAULT_INCOME_CATS])
          : prev.incomeCategories,
        expenseCategories: settings.expense_categories
          ? ((typeof settings.expense_categories === 'string'
              ? JSON.parse(settings.expense_categories)
              : settings.expense_categories).length
              ? (typeof settings.expense_categories === 'string'
                  ? JSON.parse(settings.expense_categories)
                  : settings.expense_categories)
              : [...DEFAULT_EXPENSE_CATS])
          : prev.expenseCategories,
      }));
    } catch (e) {
      console.error('Load error', e);
    }
  }, []);

  const refreshQuotesConfig = useCallback(async () => {
    try { setQuotesConfig(await api('GET', '/quotes/config')); } catch {}
  }, []);

  const startApp = useCallback(async () => {
    setLoading(true);
    await loadAll();
    await refreshQuotesConfig();
    setLoading(false);
  }, [loadAll, refreshQuotesConfig]);

  const login = useCallback(async (email, password) => {
    const res = await api('POST', '/auth/login', { email, password });
    setSession(res.token, res.user);
    setTokenState(res.token);
    setUserState(res.user);
    return res;
  }, []);

  const register = useCallback(async (email, password) => {
    const res = await api('POST', '/auth/register', { email, password });
    setSession(res.token, res.user);
    setTokenState(res.token);
    setUserState(res.user);
    return res;
  }, []);

  // Вход по Telegram Login Widget. Если уже авторизованы (есть токен) —
  // передаём его в заголовке, чтобы бэкенд привязал tg_id к аккаунту.
  const loginTelegram = useCallback(async (tgData) => {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers,
      body: JSON.stringify(tgData),
    }).then(r => r.json());
    if (res.token) {
      setSession(res.token, res.user);
      setTokenState(res.token);
      setUserState(res.user);
    }
    return res;
  }, []);

  const linkTelegram = useCallback(async (tgData) => {
    return api('POST', '/auth/link-telegram', tgData);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUserState(null);
  }, []);

  // Обновление отдельных коллекций
  const reload = useCallback(async (key) => {
    if (key === 'incomes') { const d = await api('GET', '/incomes'); setState(s => ({ ...s, incomes: d })); }
    else if (key === 'expenses') { const d = await api('GET', '/expenses'); setState(s => ({ ...s, expenses: d })); }
    else if (key === 'mandatory') { const d = await api('GET', '/mandatory'); setState(s => ({ ...s, mandatory: d })); }
    else if (key === 'debts') { const d = await api('GET', '/debts'); setState(s => ({ ...s, debts: d })); }
    else if (key === 'accounts') { const d = await api('GET', '/accounts'); setState(s => ({ ...s, accounts: d })); }
  }, []);

  const update = useCallback((patch) => setState(s => ({ ...s, ...patch })), []);

  return (
    <StoreContext.Provider value={{
      token, user, state, loading,
      quotesConfig, setQuotesConfig,
      loadAll, startApp, refreshQuotesConfig,
      login, register, logout, loginTelegram, linkTelegram,
      reload, update, setState,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
