import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api, apiDownload } from '../api.js';
import { findAccountByName, fmt, DEFAULT_INCOME_CATS, DEFAULT_EXPENSE_CATS } from '../utils.js';
import TelegramLoginButton from '../components/TelegramLoginButton.jsx';

const OPENROUTER_MODEL_PRESETS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-70b-instruct',
  'deepseek/deepseek-chat',
];
const GEMINI_MODEL_PRESETS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

export default function Settings({ toast }) {
  const { state, update, reload, setQuotesConfig, user, linkTelegram, logout } = useStore();
  const [cash, setCash] = useState(findAccountByName(state.accounts, 'Наличные')?.balance ?? '');
  const [card, setCard] = useState(findAccountByName(state.accounts, 'Карта')?.balance ?? '');
  const [salaryDay, setSalaryDay] = useState(state.salary.day || '');
  const [salaryAmount, setSalaryAmount] = useState(state.salary.amount || '');
  const [salaryPeriod, setSalaryPeriod] = useState(state.salary.period || 'monthly');
  const [newIncomeCat, setNewIncomeCat] = useState('');
  const [newExpenseCat, setNewExpenseCat] = useState('');

  const [aiProvider, setAiProvider] = useState('openrouter');
  const [orModel, setOrModel] = useState('openai/gpt-4o-mini');
  const [gmModel, setGmModel] = useState('gemini-2.0-flash');
  const [hasOrKey, setHasOrKey] = useState(false);
  const [hasGmKey, setHasGmKey] = useState(false);

  useEffect(() => {
    api('GET', '/ai/config').then(cfg => {
      setAiProvider(cfg.provider || 'openrouter');
      setOrModel(cfg.openrouterModel || 'openai/gpt-4o-mini');
      setGmModel(cfg.geminiModel || 'gemini-2.0-flash');
      setHasOrKey(!!cfg.hasOpenrouterKey);
      setHasGmKey(!!cfg.hasGeminiKey);
    }).catch(() => {});
  }, []);

  const changeProvider = async (p) => {
    setAiProvider(p);
    try { await api('PUT', '/settings/ai_provider', { value: p }); toast(`Провайдер: ${p === 'gemini' ? 'Gemini' : 'OpenRouter'}`); }
    catch { toast('Ошибка', '#ff3b30'); }
  };

  const saveModel = async (provider, value) => {
    const key = provider === 'gemini' ? 'gemini_model' : 'openrouter_model';
    try { await api('PUT', `/settings/${key}`, { value }); toast('Модель сохранена!'); }
    catch { toast('Ошибка', '#ff3b30'); }
  };

  const saveKey = async (provider, value, clearEl) => {
    const key = provider === 'gemini' ? 'gemini_key' : 'openrouter_key';
    if (!value) return;
    try {
      await api('PUT', `/settings/${key}`, { value });
      toast('Ключ сохранён!');
      if (clearEl) clearEl.value = '';
      if (provider === 'gemini') setHasGmKey(true); else setHasOrKey(true);
    } catch { toast('Ошибка', '#ff3b30'); }
  };

  const EXPORT_TYPES = [
    { type: 'incomes', label: 'Доходы' },
    { type: 'expenses', label: 'Расходы' },
    { type: 'mandatory', label: 'Обязательные платежи' },
    { type: 'debts', label: 'Долги' },
    { type: 'credit-cards', label: 'Кредитки' },
    { type: 'goals', label: 'Цели' },
  ];

  const exportCsv = async (type) => {
    try {
      await apiDownload(`/export/${type}`, `${type}.csv`);
    } catch (e) {
      toast('Ошибка экспорта', '#ff3b30');
    }
  };

  const saveAccountBalance = async (name, type, balance) => {
    const acc = findAccountByName(state.accounts, name);
    if (acc) await api('PUT', `/accounts/${acc.id}`, { name, type, currency: 'RUB', balance });
    else await api('POST', '/accounts', { name, type, currency: 'RUB', balance });
  };

  const saveCash = async () => {
    const cashVal = parseFloat(cash) || 0;
    const cardVal = parseFloat(card) || 0;
    try {
      await saveAccountBalance('Наличные', 'cash', cashVal);
      await saveAccountBalance('Карта', 'card', cardVal);
      await reload('accounts');
      toast('Балансы сохранены!');
    } catch {
      toast('Ошибка сохранения', '#ff3b30');
    }
  };

  const saveSalary = async () => {
    const salary = {
      day: parseInt(salaryDay) || null,
      amount: parseFloat(salaryAmount) || 0,
      period: salaryPeriod,
    };
    update({ salary });
    await api('PUT', '/settings/salary', { value: salary });
    toast('Данные ЗП сохранены!');
  };

  const addCat = async (type) => {
    const v = type === 'income' ? newIncomeCat.trim() : newExpenseCat.trim();
    if (type === 'income') {
      if (v && !state.incomeCategories.includes(v)) {
        const cats = [...state.incomeCategories, v];
        update({ incomeCategories: cats });
        await api('PUT', '/settings/income_categories', { value: cats });
        setNewIncomeCat('');
      }
    } else {
      if (v && !state.expenseCategories.includes(v)) {
        const cats = [...state.expenseCategories, v];
        update({ expenseCategories: cats });
        await api('PUT', '/settings/expense_categories', { value: cats });
        setNewExpenseCat('');
      }
    }
  };

  const removeCat = async (type, name) => {
    if (type === 'income') {
      const cats = state.incomeCategories.filter(c => c !== name);
      update({ incomeCategories: cats });
      await api('PUT', '/settings/income_categories', { value: cats });
    } else {
      const cats = state.expenseCategories.filter(c => c !== name);
      update({ expenseCategories: cats });
      await api('PUT', '/settings/expense_categories', { value: cats });
    }
  };

  const clearData = async () => {
    if (!confirm('Удалить ВСЕ данные? Это действие нельзя отменить.')) return;
    try {
      for (const i of state.incomes) await api('DELETE', `/incomes/${i.id}`);
      for (const e of state.expenses) await api('DELETE', `/expenses/${e.id}`);
      for (const m of state.mandatory) await api('DELETE', `/mandatory/${m.id}`);
      update({ salary: { day: null, amount: 0, period: 'monthly' } });
      await api('PUT', '/settings/salary', { value: { day: null, amount: 0, period: 'monthly' } });
      await api('PUT', '/settings/income_categories', { value: DEFAULT_INCOME_CATS });
      await api('PUT', '/settings/expense_categories', { value: DEFAULT_EXPENSE_CATS });
      await reload('incomes'); await reload('expenses'); await reload('mandatory');
      toast('Данные очищены', '#ef4444');
    } catch {
      toast('Ошибка очистки', '#ef4444');
    }
  };

  return (
    <div className="settings-grid">
      <div className="panel">
        <div className="panel-header"><span>💵 Балансы счетов</span></div>
        <div className="settings-form">
          <p className="text-muted">Стартовые балансы денег на каждый день. Доходы и расходы меняют их автоматически.</p>
          <label>Наличные (₽)</label>
          <input type="number" className="input-field" placeholder="0" value={cash} onChange={(e) => setCash(e.target.value)} />
          <label>Карта / безнал (₽)</label>
          <input type="number" className="input-field" placeholder="0" value={card} onChange={(e) => setCard(e.target.value)} />
          <button className="btn-primary" onClick={saveCash}>Сохранить</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>💼 Зарплата</span></div>
        <div className="settings-form">
          <label>День выплаты ЗП (1–31)</label>
          <input type="number" className="input-field" placeholder="5" min="1" max="31" value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} />
          <label>Размер ЗП (₽)</label>
          <input type="number" className="input-field" placeholder="0" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} />
          <label>Периодичность</label>
          <select className="input-field" value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value)}>
            <option value="monthly">Ежемесячно</option>
            <option value="biweekly">Каждые 2 недели</option>
          </select>
          <button className="btn-primary" onClick={saveSalary}>Сохранить</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🏷️ Категории доходов</span></div>
        <div className="settings-form">
          <div className="category-chips">
            {state.incomeCategories.map(c => (
              <div key={c} className="category-chip"><span>{c}</span><button className="chip-remove" onClick={() => removeCat('income', c)}>✕</button></div>
            ))}
          </div>
          <div className="add-category-row">
            <input type="text" className="input-field" placeholder="Новая категория" value={newIncomeCat} onChange={(e) => setNewIncomeCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCat('income')} />
            <button className="btn-outline" onClick={() => addCat('income')}>+</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🏷️ Категории расходов</span></div>
        <div className="settings-form">
          <div className="category-chips">
            {state.expenseCategories.map(c => (
              <div key={c} className="category-chip"><span>{c}</span><button className="chip-remove" onClick={() => removeCat('expense', c)}>✕</button></div>
            ))}
          </div>
          <div className="add-category-row">
            <input type="text" className="input-field" placeholder="Новая категория" value={newExpenseCat} onChange={(e) => setNewExpenseCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCat('expense')} />
            <button className="btn-outline" onClick={() => addCat('expense')}>+</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🧠 AI-помощник</span></div>
        <div className="settings-form">
          <p className="text-muted">Выберите провайдера, модель и укажите ключ API. Если ключ не задан — AI отвечает в базовом режиме.</p>

          <div className={`source-toggle ${aiProvider === 'gemini' ? 'is-second' : ''}`} role="tablist" style={{ maxWidth: 280 }}>
            <button type="button" className={`source-opt ${aiProvider === 'openrouter' ? 'active' : ''}`} onClick={() => changeProvider('openrouter')}>OpenRouter</button>
            <button type="button" className={`source-opt ${aiProvider === 'gemini' ? 'active' : ''}`} onClick={() => changeProvider('gemini')}>Gemini</button>
            <span className="source-thumb" aria-hidden="true"></span>
          </div>

          {aiProvider === 'openrouter' ? (
            <>
              <label style={{ marginTop: 12, display: 'block' }}>Модель</label>
              <select className="input-field" value={OPENROUTER_MODEL_PRESETS.includes(orModel) ? orModel : '__custom'}
                onChange={(e) => { if (e.target.value !== '__custom') { setOrModel(e.target.value); saveModel('openrouter', e.target.value); } }}>
                {OPENROUTER_MODEL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="__custom">Другая модель…</option>
              </select>
              <input type="text" className="input-field" style={{ marginTop: 6 }} value={orModel}
                onChange={(e) => setOrModel(e.target.value)}
                onBlur={() => saveModel('openrouter', orModel)}
                placeholder="id модели OpenRouter" />

              <label style={{ marginTop: 12, display: 'block' }}>Ключ API {hasOrKey && <span className="text-muted" style={{ fontWeight: 400 }}>(сохранён)</span>}</label>
              <div className="add-category-row">
                <input type="password" className="input-field" id="or-key-input" placeholder="sk-or-v1-..."
                  onKeyDown={(e) => { if (e.key === 'Enter') saveKey('openrouter', e.target.value.trim(), e.target); }} />
                <button className="btn-outline" onClick={() => { const el = document.getElementById('or-key-input'); saveKey('openrouter', el?.value?.trim(), el); }}>Сохранить</button>
              </div>
              <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Получить ключ: <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Введите и нажмите Enter или кнопку.</p>
            </>
          ) : (
            <>
              <label style={{ marginTop: 12, display: 'block' }}>Модель</label>
              <select className="input-field" value={GEMINI_MODEL_PRESETS.includes(gmModel) ? gmModel : '__custom'}
                onChange={(e) => { if (e.target.value !== '__custom') { setGmModel(e.target.value); saveModel('gemini', e.target.value); } }}>
                {GEMINI_MODEL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="__custom">Другая модель…</option>
              </select>
              <input type="text" className="input-field" style={{ marginTop: 6 }} value={gmModel}
                onChange={(e) => setGmModel(e.target.value)}
                onBlur={() => saveModel('gemini', gmModel)}
                placeholder="id модели Gemini" />

              <label style={{ marginTop: 12, display: 'block' }}>Ключ API {hasGmKey && <span className="text-muted" style={{ fontWeight: 400 }}>(сохранён)</span>}</label>
              <div className="add-category-row">
                <input type="password" className="input-field" id="gm-key-input" placeholder="AIza..."
                  onKeyDown={(e) => { if (e.key === 'Enter') saveKey('gemini', e.target.value.trim(), e.target); }} />
                <button className="btn-outline" onClick={() => { const el = document.getElementById('gm-key-input'); saveKey('gemini', el?.value?.trim(), el); }}>Сохранить</button>
              </div>
              <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Получить ключ: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Введите и нажмите Enter или кнопку.</p>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>💬 Telegram</span></div>
        <div className="settings-form">
          <p className="text-muted">
            {user?.tg_id ? '✅ Telegram привязан к аккаунту. Можно входить по кнопке «Войти через Telegram».'
                        : 'Привяжите Telegram, чтобы входить в один клик и получать напоминания о платежах.'}
          </p>
          {!user?.tg_id && (
            <TelegramLoginButton onAuth={async (u) => {
              try { await linkTelegram(u); toast('Telegram привязан!'); }
              catch (e) { toast(e.message || 'Ошибка привязки', '#ff3b30'); }
            }} />
          )}
        </div>
      </div>

      <div className="panel panel-danger">
        <div className="panel-header"><span>⚠️ Данные</span></div>
        <div className="settings-form">
          <div className="excel-note">
            <div className="excel-note-title">📊 Экспорт данных</div>
            <p className="text-muted">Выгрузка в CSV — открывается в Excel и Google Таблицах.</p>
            <div className="export-btn-row">
              {EXPORT_TYPES.map(e => (
                <button key={e.type} className="btn-outline" onClick={() => exportCsv(e.type)}>📥 {e.label}</button>
              ))}
            </div>
          </div>
          <hr style={{ borderColor: 'var(--border)', margin: '12px 0' }} />
          <button className="btn-danger" onClick={clearData}>🗑️ Очистить все данные</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🔓 Сессия</span></div>
        <div className="settings-form">
          <button className="btn-outline" onClick={logout}>Выйти из аккаунта</button>
        </div>
      </div>
    </div>
  );
}
