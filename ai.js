// ===================================================================
// FinanceBot — ai.js  (AI-рекомендации и чат через OpenRouter или Gemini)
// Ключи API хранятся ТОЛЬКО на сервере (в settings под user_id='system' —
// общий инстанс-ключ, не привязан к конкретному пользователю).
// Если ключ не задан или LLM недоступен — deterministic rule-based фолбэк.
// В LLM уходят ТОЛЬКО агрегированные/анонимные суммы и категории (без ФИО/PII).
// ===================================================================
const express = require('express');
const router = express.Router();
const { nowVladivostok } = require('./timezone');

const OPENROUTER_ENV_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_APi || process.env.OPENROUTER_API;
const OPENROUTER_ENV_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const GEMINI_ENV_KEY = process.env.GEMINI_API_KEY;
const GEMINI_ENV_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const APP_URL = process.env.APP_URL || 'https://maz.stormkhv.ru';

function rub(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

// Читает общесистемную (user_id='system') настройку из settings, JSON-декодируя значение.
async function getSystemSetting(query, key) {
  try {
    const r = await query("SELECT value FROM settings WHERE user_id='system' AND key=?", [key]);
    const val = r.rows[0]?.value;
    if (val === undefined || val === null) return null;
    return JSON.parse(val);
  } catch { return null; }
}

async function getProvider(query) {
  const p = await getSystemSetting(query, 'ai_provider');
  return p === 'gemini' ? 'gemini' : 'openrouter';
}

async function getOpenRouterKey(query) {
  if (OPENROUTER_ENV_KEY) return OPENROUTER_ENV_KEY;
  const v = await getSystemSetting(query, 'openrouter_key');
  return typeof v === 'string' && v ? v : null;
}

async function getGeminiKey(query) {
  if (GEMINI_ENV_KEY) return GEMINI_ENV_KEY;
  const v = await getSystemSetting(query, 'gemini_key');
  return typeof v === 'string' && v ? v : null;
}

async function getModel(query, provider) {
  const key = provider === 'gemini' ? 'gemini_model' : 'openrouter_model';
  const v = await getSystemSetting(query, key);
  if (typeof v === 'string' && v) return v;
  return provider === 'gemini' ? GEMINI_ENV_MODEL : OPENROUTER_ENV_MODEL;
}

// Вызов OpenRouter chat completions. Возвращает текст или null при ошибке/отсутствии ключа.
async function openRouterChat(messages, query, temperature = 0.7) {
  const key = await getOpenRouterKey(query);
  if (!key) return null;
  const model = await getModel(query, 'openrouter');
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_URL,
        'X-Title': 'FinanceBot',
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 700 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}

// Вызов Gemini generateContent. Переводит OpenAI-подобные messages (system/user/assistant)
// в формат Gemini (systemInstruction + contents с ролями user/model).
async function geminiChat(messages, query, temperature = 0.7) {
  const key = await getGeminiKey(query);
  if (!key) return null;
  const model = await getModel(query, 'gemini');
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          contents,
          generationConfig: { temperature, maxOutputTokens: 700 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() || null : null;
  } catch (e) {
    return null;
  }
}

// Единая точка входа: выбирает провайдера (OpenRouter/Gemini) по настройке ai_provider.
async function llmChat(messages, query, temperature = 0.7) {
  const provider = await getProvider(query);
  return provider === 'gemini' ? geminiChat(messages, query, temperature) : openRouterChat(messages, query, temperature);
}

// Анонимизированная сводка пользователя за последние 3 месяца
async function buildSummary(query, userId) {
  const monthAgo = nowVladivostok(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = nowVladivostok(); threeAgo.setMonth(threeAgo.getMonth() - 3);

  const groupSql = (table) => `
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM ${table} WHERE user_id=? AND datetime >= ? GROUP BY category ORDER BY total DESC`;

  const [inc, exp, mand, goals, cards, accounts, debts] = await Promise.all([
    query(groupSql('incomes'), [userId, threeAgo.toISOString()]),
    query(groupSql('expenses'), [userId, threeAgo.toISOString()]),
    query('SELECT name, amount, type, day, status FROM mandatory_payments WHERE user_id=?', [userId]),
    query('SELECT title, target_amount, current_amount, deadline FROM goals WHERE user_id=?', [userId]),
    query('SELECT name, limit_amount, balance FROM credit_cards WHERE user_id=?', [userId]),
    query('SELECT name, type, currency, balance FROM accounts WHERE user_id=?', [userId]),
    query('SELECT person, amount, note, direction, status, due_date FROM debts WHERE user_id=?', [userId]),
  ]);

  // Расходы текущего месяца vs среднего за 3 месяца по категориям
  const curMonth = await query(groupSql('expenses'), [userId, monthAgo.toISOString()]);

  const fmtGroups = (rows) => rows.rows.length
    ? rows.rows.map(r => `  • ${r.category}: ${rub(r.total)}`).join('\n')
    : '  (нет данных)';

  let summary = `Финансовая сводка пользователя (анонимно, только суммы и категории):\n\n`;
  summary += `Доходы за 3 месяца:\n${fmtGroups(inc)}\n\n`;
  summary += `Расходы за 3 месяца:\n${fmtGroups(exp)}\n\n`;
  summary += `Расходы за текущий месяц:\n${fmtGroups(curMonth)}\n\n`;
  summary += `Обязательные платежи:\n` + (mand.rows.length
    ? mand.rows.map(m => `  • ${m.name} (${m.category || m.type}): ${rub(m.amount)}${m.status === 'paid' ? ' [оплачено]' : ''}`).join('\n')
    : '  (нет)') + '\n\n';
  summary += `Цели накопления:\n` + (goals.rows.length
    ? goals.rows.map(g => `  • ${g.title}: накоплено ${rub(g.current_amount)} из ${rub(g.target_amount)}${g.deadline ? ' до ' + g.deadline : ''}`).join('\n')
    : '  (нет)');
  summary += `\n\nКредитные карты (это долг, который нужно закрывать, а не доступные для трат деньги):\n` + (cards.rows.length
    ? cards.rows.map(c => c.balance > 0
        ? `  • ${c.name}: долг ${rub(c.balance)} (лимит карты ${rub(c.limit_amount)})`
        : `  • ${c.name}: погашена, долга нет`).join('\n')
    : '  (нет)');
  summary += `\n\nСчета и балансы:\n` + (accounts.rows.length
    ? accounts.rows.map(a => `  • ${a.name} (${a.type}): ${rub(a.balance)} ${a.currency || ''}`).join('\n')
    : '  (нет)');
  summary += `\n\nДолги:\n` + (debts.rows.length
    ? debts.rows.map(d => `  • ${d.person}: ${rub(d.amount)}${d.direction === 'i_owe' ? ' (я должен)' : ' (мне должны)'}${d.status === 'paid' ? ' [закрыт]' : ''}${d.due_date ? ', срок ' + d.due_date : ''}${d.note ? ' — ' + d.note : ''}`).join('\n')
    : '  (нет)');
  return summary;
}

// Rule-based советы (детерминированные, без LLM)
async function ruleBasedAdvice(query, userId) {
  const monthAgo = nowVladivostok(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = nowVladivostok(); threeAgo.setMonth(threeAgo.getMonth() - 3);

  const cur = await query(
    `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE user_id=? AND datetime >= ? GROUP BY category`, [userId, monthAgo.toISOString()]);
  const prev = await query(
    `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE user_id=? AND datetime >= ? AND datetime < ? GROUP BY category`,
    [userId, threeAgo.toISOString(), monthAgo.toISOString()]);

  const prevAvg = {};
  prev.rows.forEach(r => { prevAvg[r.category] = Number(r.total) / 3; });

  const tips = [];
  cur.rows.forEach(r => {
    const avg = prevAvg[r.category] || 0;
    if (avg > 0 && Number(r.total) > avg * 1.3) {
      const over = Number(r.total) - avg;
      tips.push(`В категории «${r.category}» расходы выросли на ${Math.round((Number(r.total) / avg - 1) * 100)}% по сравнению со средним. Можно сэкономить около ${rub(over)} в месяц.`);
    }
  });

  const goals = await query('SELECT title, target_amount, current_amount FROM goals WHERE user_id=?', [userId]);
  goals.rows.forEach(g => {
    const pct = Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100);
    if (pct < 100) tips.push(`По цели «${g.title}» накоплено ${pct}%. Продолжайте регулярно откладывать — это формирует привычку копить.`);
  });

  const mand = await query("SELECT COUNT(*) AS c FROM mandatory_payments WHERE user_id=? AND status<>'paid'", [userId]);
  if (Number(mand.rows[0].c) > 0) {
    tips.push(`У вас ${mand.rows[0].c} неоплаченных обязательных платежей. Запланируйте их оплату заранее, чтобы избежать просрочек.`);
  }

  if (!tips.length) {
    tips.push('Продолжайте фиксировать расходы — чем больше данных, тем точнее будут рекомендации.');
    tips.push('Попробуйте выделить одну категорию и сократить её на 10% в этом месяце.');
  }
  return tips.slice(0, 5);
}

// Детерминированная сводка: с начала текущего месяца vs весь предыдущий месяц.
// Без LLM — быстро, бесплатно, не зависит от того, задан ли API-ключ.
async function monthlySummary(query, userId) {
  const now = nowVladivostok();
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const curStartIso = curStart.toISOString();
  const prevStartIso = prevStart.toISOString();

  const [incCur, incPrev, expCurByCat, expPrevByCat] = await Promise.all([
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM incomes WHERE user_id=? AND datetime >= ?`, [userId, curStartIso]),
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM incomes WHERE user_id=? AND datetime >= ? AND datetime < ?`, [userId, prevStartIso, curStartIso]),
    query(`SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses WHERE user_id=? AND datetime >= ? GROUP BY category`, [userId, curStartIso]),
    query(`SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses WHERE user_id=? AND datetime >= ? AND datetime < ? GROUP BY category`, [userId, prevStartIso, curStartIso]),
  ]);

  const tips = [];
  const pctChange = (cur, prev) => Math.round(((cur - prev) / prev) * 100);

  const incCurTotal = Number(incCur.rows[0].total);
  const incPrevTotal = Number(incPrev.rows[0].total);
  if (incPrevTotal > 0) {
    const pct = pctChange(incCurTotal, incPrevTotal);
    tips.push(`Доход с начала месяца: ${rub(incCurTotal)} — это на ${Math.abs(pct)}% ${pct >= 0 ? 'больше' : 'меньше'}, чем за весь прошлый месяц (${rub(incPrevTotal)}).`);
  }

  const prevByCat = {};
  expPrevByCat.rows.forEach(r => { prevByCat[r.category] = Number(r.total); });

  const catDeltas = expCurByCat.rows
    .filter(r => prevByCat[r.category] > 0)
    .map(r => ({
      category: r.category,
      cur: Number(r.total),
      prev: prevByCat[r.category],
      pct: pctChange(Number(r.total), prevByCat[r.category]),
    }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 5);

  catDeltas.forEach(d => {
    tips.push(`Расходы на «${d.category}»: ${rub(d.cur)} с начала месяца — на ${Math.abs(d.pct)}% ${d.pct >= 0 ? 'больше' : 'меньше'}, чем за весь прошлый месяц (${rub(d.prev)}).`);
  });

  if (!tips.length) {
    tips.push('Пока недостаточно данных за прошлый месяц для сравнения.');
  }
  return tips;
}

// GET /api/ai/monthly-summary — сводка месяца (текущий месяц vs весь предыдущий)
router.get('/monthly-summary', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const tips = await monthlySummary(query, req.userId);
    res.json({ tips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/config — текущий провайдер/модели и наличие ключей (сами ключи не отдаются)
router.get('/config', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const [provider, openrouterModel, geminiModel, orKey, gmKey] = await Promise.all([
      getProvider(query),
      getModel(query, 'openrouter'),
      getModel(query, 'gemini'),
      getOpenRouterKey(query),
      getGeminiKey(query),
    ]);
    res.json({
      provider,
      openrouterModel,
      geminiModel,
      hasOpenrouterKey: !!orKey,
      hasGeminiKey: !!gmKey,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/advice — еженедельный/месячный дайджест из 3+ советов
router.post('/advice', async (req, res) => {
  const { query } = req.app.locals.db;
  try {
    const summary = await buildSummary(query, req.userId);
    const systemAdvicePrompt = `Ты — персональный финансовый AI-ассистент FinanceBot.

Твоя задача — давать 3-5 конкретных, практичных и персонализированных советов на основе финансовой сводки пользователя.

Правила:
- Пиши на русском, дружелюбно, коротко, без воды
- Каждый совет с новой строки, без нумерации, без заголовков
- Не используй markdown, звёздочки, эмодзи, символы — только обычный текст
- Не выдумывай цифры, которых нет в сводке
- Анализируй: где можно сократить расходы, как быстрее закрыть долги (включая долг по кредитке), что сделать для достижения целей
- Долг по кредитной карте — это задолженность, которую нужно гасить, а не лимит для новых трат. Не советуй пользователю тратить с кредитки — только гасить долг
- Учитывай реальные балансы счетов и долги (кто кому должен) из сводки при советах о свободных средствах
- Если есть свободные средства — предложи варианты: накопление, досрочное погашение долгов, инвестиции`;

    const aiText = await llmChat([
      { role: 'system', content: systemAdvicePrompt },
      { role: 'user', content: 'Вот моя финансовая сводка:\n\n' + summary },
    ], query);
    if (aiText) {
      const tips = aiText.split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
      return res.json({ tips, source: 'ai' });
    }
    const tips = await ruleBasedAdvice(query, req.userId);
    res.json({ tips, source: 'rules' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — диалог с ассистентом
router.post('/chat', async (req, res) => {
  const { query } = req.app.locals.db;
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Пустое сообщение' });
  try {
    const summary = await buildSummary(query, req.userId);
    const systemChatPrompt = `Ты — персональный финансовый AI-помощник в приложении FinanceBot.

Твоя роль:
- Анализировать финансы пользователя на основе его данных: доходы, расходы, обязательные платежи, долги, кредитные карты, счета и балансы, цели накопления
- Отвечать на вопросы о финансах, давать конкретные рекомендации
- Помогать принимать решения: может ли пользователь позволить себе покупку, сколько можно отложить, как сократить расходы

Правила оформления ответа:
- Пиши ТОЛЬКО обычным текстом. Никакого markdown, никаких звёздочек, тире, эмодзи, символов — просто слова и цифры
- Если нужно перечислить — используй обычные строки с цифрами (1. ..., 2. ...) без дополнительных символов
- Отвечай на русском, дружелюбно, по делу, коротко
- НЕ выдумывай точные цифры — используй ТОЛЬКО те, что есть в сводке ниже. Если данных для ответа недостаточно — честно скажи об этом
- Если пользователь спрашивает "могу ли я купить X за N рублей" — проанализируй: остаток после обязательных расходов, текущий баланс счетов, долги по кредитке, и дай обоснованный ответ
- Долг по кредитной карте — это задолженность к погашению, а НЕ доступные для трат деньги. Не предлагай тратить с кредитки, только гасить долг по ней
- Не давай инвестиционных советов (покупать/продавать конкретные активы)

Сводка финансов пользователя:
${summary}`;

    const messages = [
      { role: 'system', content: systemChatPrompt },
    ];
    if (Array.isArray(history)) {
      history.slice(-10).forEach(h => {
        if (h.role && h.content) messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
      });
    }
    messages.push({ role: 'user', content: message });

    const reply = await llmChat(messages, query, 0.8);
    if (reply) return res.json({ reply, source: 'ai' });

    // Fallback-ответ без LLM
    const fallback = `Я сейчас работаю в базовом режиме (без подключения к AI). ` +
      `Общая рекомендация: фиксируйте все расходы, выделите категорию для сокращения на 10% и регулярно откладывайте на цели. ` +
      `Детальный разбор появится, когда подключим языковую модель.`;
    res.json({ reply: fallback, source: 'rules' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
