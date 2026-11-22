import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { findAccountByName, fmt, DEFAULT_INCOME_CATS, DEFAULT_EXPENSE_CATS } from '../utils.js';
import TelegramLoginButton from '../components/TelegramLoginButton.jsx';
import { getThemeMode, setThemeMode } from '../theme.js';
import Icon from '../components/Icon.jsx';

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

export default function Settings() {
  const { state, update, reload, setQuotesConfig, user, linkTelegram, logout, toast, confirmAction } = useStore();
  const [cash, setCash] = useState(findAccountByName(state.accounts, 'Наличные')?.balance ?? '');
  const [card, setCard] = useState(findAccountByName(state.accounts, 'Карта')?.balance ?? '');
  const [salaryDay, setSalaryDay] = useState(state.salary.day || '');
  const [salaryPeriod, setSalaryPeriod] = useState(state.salary.period || 'monthly');
  const [salaryAnchorDate, setSalaryAnchorDate] = useState(state.salary.anchorDate || '');

  useEffect(() => {
    setSalaryDay(state.salary.day || '');
    setSalaryPeriod(state.salary.period || 'monthly');
    setSalaryAnchorDate(state.salary.anchorDate || '');
  }, [state.salary]);

  useEffect(() => {
    setCash(findAccountByName(state.accounts, 'Наличные')?.balance ?? '');
    setCard(findAccountByName(state.accounts, 'Карта')?.balance ?? '');
  }, [state.accounts]);
  const [newIncomeCat, setNewIncomeCat] = useState('');
  const [newExpenseCat, setNewExpenseCat] = useState('');
  const [newRuleAmount, setNewRuleAmount] = useState('');
  const [newRuleCategory, setNewRuleCategory] = useState(state.expenseCategories[0] || '');
  const [budgetDraft, setBudgetDraft] = useState(state.budgets || {});
  useEffect(() => setBudgetDraft(state.budgets || {}), [state.budgets]);
  const saveBudgets = async () => {
    const cleaned = Object.fromEntries(Object.entries(budgetDraft).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    try { await api('PUT', '/settings/budgets', { value: cleaned }); update({ budgets: cleaned }); toast('Бюджеты сохранены'); }
    catch { toast('Ошибка сохранения бюджетов', '#ff3b30'); }
  };

  const [themeMode, setThemeModeState] = useState(getThemeMode());
  const changeTheme = async (mode) => {
    setThemeModeState(mode);
    setThemeMode(mode);
    try { await api('PUT', '/settings/theme_mode', { value: mode }); }
    catch { toast('Ошибка сохранения темы', '#ff3b30'); }
  };

  const [aiProvider, setAiProvider] = useState('openrouter');
  const [orModel, setOrModel] = useState('openai/gpt-4o-mini');
  const [gmModel, setGmModel] = useState('gemini-2.0-flash');
  const [hasOrKey, setHasOrKey] = useState(false);
  const [hasGmKey, setHasGmKey] = useState(false);
  const [gmail, setGmail] = useState({ configured: false, connected: false, email: null });
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailDrafts, setGmailDrafts] = useState([]);

  useEffect(() => {
    api('GET', '/ai/config').then(cfg => {
      setAiProvider(cfg.provider || 'openrouter');
      setOrModel(cfg.openrouterModel || 'openai/gpt-4o-mini');
      setGmModel(cfg.geminiModel || 'gemini-2.0-flash');
      setHasOrKey(!!cfg.hasOpenrouterKey);
      setHasGmKey(!!cfg.hasGeminiKey);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api('GET', '/integrations/gmail/status').then(setGmail).catch(() => {});
  }, []);

  useEffect(() => {
    if (gmail.connected) api('GET', '/integrations/gmail/drafts').then(setGmailDrafts).catch(() => {});
  }, [gmail.connected]);

  const connectGmail = async () => {
    setGmailBusy(true);
    try {
      const { url } = await api('GET', '/integrations/gmail/connect');
      window.location.assign(url);
    } catch (e) {
      toast(e.message || 'Не удалось открыть подключение Gmail', '#ff3b30');
      setGmailBusy(false);
    }
  };

  const disconnectGmail = async () => {
    try {
      await api('DELETE', '/integrations/gmail/disconnect');
      setGmail({ ...gmail, connected: false, email: null });
      toast('Gmail отключён');
    } catch { toast('Ошибка отключения Gmail', '#ff3b30'); }
  };

  const syncGmail = async () => {
    setGmailBusy(true);
    try {
      const result = await api('POST', '/integrations/gmail/sync');
      const drafts = await api('GET', '/integrations/gmail/drafts');
      setGmailDrafts(drafts);
      toast(result.created ? `Найдено чеков: ${result.created}` : 'Новых чеков не найдено');
    } catch (e) { toast(e.message || 'Ошибка проверки Gmail', '#ff3b30'); }
    finally { setGmailBusy(false); }
  };

  const approveGmailDraft = async (id) => {
    try { await api('POST', `/integrations/gmail/drafts/${id}/approve`, { source: 'Карта' }); setGmailDrafts(d => d.filter(x => x.id !== id)); await reload('expenses'); await reload('accounts'); toast('Операция добавлена'); }
    catch (e) { toast(e.message || 'Ошибка добавления операции', '#ff3b30'); }
  };

  const rejectGmailDraft = async (id) => {
    try { await api('DELETE', `/integrations/gmail/drafts/${id}`); setGmailDrafts(d => d.filter(x => x.id !== id)); toast('Черновик отклонён'); }
    catch { toast('Ошибка', '#ff3b30'); }
  };

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
      period: salaryPeriod,
      anchorDate: salaryPeriod === 'biweekly' ? (salaryAnchorDate || null) : null,
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

  const addCategoryRule = async () => {
    const amt = parseFloat(newRuleAmount);
    if (isNaN(amt) || amt <= 0) { toast('Введите сумму', '#ff3b30'); return; }
    if (!newRuleCategory) { toast('Выберите категорию', '#ff3b30'); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const rules = [...state.categoryRules, { id, maxAmount: amt, category: newRuleCategory }];
    update({ categoryRules: rules });
    await api('PUT', '/settings/category_rules', { value: rules });
    setNewRuleAmount('');
  };

  const removeCategoryRule = async (id) => {
    const rules = state.categoryRules.filter(r => r.id !== id);
    update({ categoryRules: rules });
    await api('PUT', '/settings/category_rules', { value: rules });
  };

  const clearData = () => {
    confirmAction('Удалить ВСЕ данные? Это действие нельзя отменить.', async () => {
      try {
        for (const i of state.incomes) await api('DELETE', `/incomes/${i.id}`);
        for (const e of state.expenses) await api('DELETE', `/expenses/${e.id}`);
        for (const m of state.mandatory) await api('DELETE', `/mandatory/${m.id}`);
        update({ salary: { day: null, period: 'monthly' } });
        await api('PUT', '/settings/salary', { value: { day: null, period: 'monthly' } });
        await api('PUT', '/settings/income_categories', { value: DEFAULT_INCOME_CATS });
        await api('PUT', '/settings/expense_categories', { value: DEFAULT_EXPENSE_CATS });
        await reload('incomes'); await reload('expenses'); await reload('mandatory');
        toast('Данные очищены', '#ff3b30');
      } catch {
        toast('Ошибка очистки', '#ff3b30');
      }
    });
  };

  return (
    <>
    <div className="settings-grid">
      <div className="panel">
        <div className="panel-header"><span><Icon name="palette" /> Тема</span></div>
        <div className="settings-form">
          <p className="text-muted">«Авто» переключает тему по владивостокскому времени: светлая с 6:00 до 18:00, тёмная — в остальное время.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[{ v: 'auto', l: '🌓 Авто' }, { v: 'light', l: '☀️ Светлая' }, { v: 'dark', l: '🌙 Тёмная' }].map(o => (
              <button key={o.v} type="button"
                className={themeMode === o.v ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
                onClick={() => changeTheme(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span><Icon name="wallet" /> Балансы счетов</span></div>
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
        <div className="panel-header"><span><Icon name="briefcase" /> Зарплата</span></div>
        <div className="settings-form">
          <label>Периодичность</label>
          <select className="input-field" value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value)}>
            <option value="monthly">Ежемесячно</option>
            <option value="biweekly">Каждые 2 недели</option>
          </select>
          {salaryPeriod === 'monthly' ? (
            <>
              <label>День выплаты ЗП (1–31)</label>
              <input type="number" className="input-field" placeholder="5" min="1" max="31" value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} />
            </>
          ) : (
            <>
              <label>Дата ближайшей выплаты</label>
              <input type="date" className="input-field" value={salaryAnchorDate} onChange={(e) => setSalaryAnchorDate(e.target.value)} />
              <p className="text-muted">От этой даты будем отсчитывать каждые 2 недели.</p>
            </>
          )}
          <button className="btn-primary" onClick={saveSalary}>Сохранить</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🏷️ Категории доходов</span></div>
        <div className="settings-form">
          <div className="category-chips">
            {state.incomeCategories.map(c => (
              <div key={c} className="category-chip"><span>{c}</span><button className="chip-remove" onClick={() => removeCat('income', c)} aria-label={`Удалить категорию ${c}`}>✕</button></div>
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
              <div key={c} className="category-chip"><span>{c}</span><button className="chip-remove" onClick={() => removeCat('expense', c)} aria-label={`Удалить категорию ${c}`}>✕</button></div>
            ))}
          </div>
          <div className="add-category-row">
            <input type="text" className="input-field" placeholder="Новая категория" value={newExpenseCat} onChange={(e) => setNewExpenseCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCat('expense')} />
            <button className="btn-outline" onClick={() => addCat('expense')}>+</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🎯 Правила категорий по сумме</span></div>
        <div className="settings-form">
          <p className="text-muted">При добавлении расхода на сумму до указанной категория подставится автоматически. Например: «до 70 ₽ → Транспорт».</p>
          {state.categoryRules.length > 0 && (
            <div className="category-chips">
              {[...state.categoryRules].sort((a, b) => Number(a.maxAmount) - Number(b.maxAmount)).map(r => (
                <div key={r.id} className="category-chip">
                  <span>до {r.maxAmount} ₽ → {r.category}</span>
                  <button className="chip-remove" onClick={() => removeCategoryRule(r.id)} aria-label={`Удалить правило до ${r.maxAmount} ₽`}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="add-category-row">
            <input type="number" className="input-field" placeholder="Сумма до, ₽" style={{ maxWidth: 140 }} value={newRuleAmount} onChange={(e) => setNewRuleAmount(e.target.value)} />
            <select className="input-field" value={newRuleCategory} onChange={(e) => setNewRuleCategory(e.target.value)}>
              {state.expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn-outline" onClick={addCategoryRule}>+</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span><Icon name="chart" /> Бюджеты по категориям</span></div>
        <div className="settings-form">
          <p className="text-muted">Месячный лимит расходов. Оставьте поле пустым, если лимит не нужен.</p>
          <div className="budget-settings-list">
            {state.expenseCategories.map(category => (
              <label key={category} className="budget-setting-row">
                <span>{category}</span>
                <input type="number" min="0" inputMode="decimal" className="input-field" placeholder="Без лимита" value={budgetDraft[category] ?? ''} onChange={e => setBudgetDraft(b => ({ ...b, [category]: e.target.value }))} />
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={saveBudgets}>Сохранить бюджеты</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span><Icon name="bot" /> AI-помощник</span></div>
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

    </div>

    <div className="settings-row-3">
      <div className="panel">
        <div className="panel-header"><span><Icon name="message" /> Telegram</span></div>
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

      <div className="panel">
        <div className="panel-header"><span><Icon name="receipt" /> Gmail и чеки</span></div>
        <div className="settings-form">
          <p className="text-muted">Finly сможет находить письма с чеками и готовить операции на проверку. Доступ запрашивается только для чтения почты.</p>
          {gmail.connected ? (
            <>
              <p className="text-muted">✅ Подключён{gmail.email ? `: ${gmail.email}` : ''}</p>
              <button className="btn-outline" onClick={syncGmail} disabled={gmailBusy}>{gmailBusy ? 'Проверяем…' : 'Проверить новые чеки'}</button>
              {gmailDrafts.length > 0 && <div className="gmail-drafts">
                <strong>Черновики чеков</strong>
                {gmailDrafts.map(d => <div className="gmail-draft" key={d.id}>
                  <div><b>{Number(d.amount).toLocaleString('ru-RU')} ₽</b><br /><span>{d.description || d.subject}</span></div>
                  <div className="gmail-draft-actions"><button className="btn-primary btn-sm" onClick={() => approveGmailDraft(d.id)}>Добавить</button><button className="btn-outline btn-sm" onClick={() => rejectGmailDraft(d.id)}>Отклонить</button></div>
                </div>)}
              </div>}
              <button className="btn-outline" onClick={disconnectGmail}>Отключить Gmail</button>
            </>
          ) : (
            <button className="btn-primary" onClick={connectGmail} disabled={gmailBusy || !gmail.configured}>
              {gmailBusy ? 'Открываем Google…' : gmail.configured ? 'Подключить Gmail' : 'Gmail пока не настроен'}
            </button>
          )}
          {!gmail.configured && <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>Администратору нужно добавить OAuth-параметры на сервер.</p>}
        </div>
      </div>

      <div className="panel panel-danger">
        <div className="panel-header"><span>⚠️ Данные</span></div>
        <div className="settings-form">
          <button className="btn-danger" onClick={clearData}><Icon name="trash" /> Очистить все данные</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><span>🔓 Сессия</span></div>
        <div className="settings-form">
          <button className="btn-outline" onClick={logout}>Выйти из аккаунта</button>
        </div>
      </div>
    </div>
    </>
  );
}
