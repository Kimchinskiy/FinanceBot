// ===================================================================
// FinanceBot — ai.js  (AI-рекомендации и чат через OpenRouter)
// Ключ OPENROUTER_API_KEY хранится ТОЛЬКО на сервере.
// Если ключ не задан или LLM недоступен — deterministic rule-based фолбэк.
// В LLM уходят ТОЛЬКО агрегированные/анонимные суммы и категории (без ФИО/PII).
// ===================================================================
const express = require('express');
const router = express.Router();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_APi || process.env.OPENROUTER_API;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const APP_URL = process.env.APP_URL || 'https://maz.stormkhv.ru';

function rub(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

// Вызов OpenRouter chat completions. Возвращает текст или null при ошибке/отсутствии ключа.
async function getOpenRouterKey(query) {
  if (OPENROUTER_KEY) return OPENROUTER_KEY;
  try {
    const r = await query("SELECT value FROM settings WHERE user_id='system' AND key='openrouter_key'");
    const val = r.rows[0]?.value;
    if (!val) return null;
    const parsed = JSON.parse(val);
    return typeof parsed === 'string' ? parsed : null;
  } catch { return null; }
}

async function openRouterChat(messages, query, temperature = 0.7) {
  const key = await getOpenRouterKey(query);
  if (!key) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_URL,
        'X-Title': 'FinanceBot',
      },
      body: JSON.stringify({ model: OPENROUTER_MODEL, messages, temperature, max_tokens: 700 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}

// Анонимизированная сводка пользователя за последние 3 месяца
async function buildSummary(query, userId) {
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = new Date(); threeAgo.setMonth(threeAgo.getMonth() - 3);

  const groupSql = (table) => `
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM ${table} WHERE user_id=? AND datetime >= ? GROUP BY category ORDER BY total DESC`;

  const [inc, exp, mand, goals, cards] = await Promise.all([
    query(groupSql('incomes'), [userId, threeAgo.toISOString()]),
    query(groupSql('expenses'), [userId, threeAgo.toISOString()]),
    query('SELECT name, amount, type, day, status FROM mandatory_payments WHERE user_id=?', [userId]),
    query('SELECT title, target_amount, current_amount, deadline FROM goals WHERE user_id=?', [userId]),
    query('SELECT name, limit_amount, balance FROM credit_cards WHERE user_id=?', [userId]),
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
  summary += `\n\nКредитные карты:\n` + (cards.rows.length
    ? cards.rows.map(c => `  • ${c.name}: задолженность ${rub(c.balance)} из лимита ${rub(c.limit_amount)}, доступно ${rub(Math.max(0, c.limit_amount - c.balance))}`).join('\n')
    : '  (нет)');
  return summary;
}

// Rule-based советы (детерминированные, без LLM)
async function ruleBasedAdvice(query, userId) {
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = new Date(); threeAgo.setMonth(threeAgo.getMonth() - 3);

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
- Анализируй: где можно сократить расходы, как оптимизировать долги и кредитку, что сделать для достижения целей
- Если у пользователя есть кредитная карта — рекомендую как ей управлять (не превышать лимит, вовремя гасить)
- Если есть свободные средства — предложи варианты: накопление, досрочное погашение долгов, инвестиции`;

    const aiText = await openRouterChat([
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
- Анализировать финансы пользователя на основе его данных: доходы, расходы, обязательные платежи, долги, кредитные карты, цели накопления
- Отвечать на вопросы о финансах, давать конкретные рекомендации
- Помогать принимать решения: может ли пользователь позволить себе покупку, сколько можно отложить, как сократить расходы

Правила оформления ответа:
- Пиши ТОЛЬКО обычным текстом. Никакого markdown, никаких звёздочек, тире, эмодзи, символов — просто слова и цифры
- Если нужно перечислить — используй обычные строки с цифрами (1. ..., 2. ...) без дополнительных символов
- Отвечай на русском, дружелюбно, по делу, коротко
- НЕ выдумывай точные цифры — используй ТОЛЬКО те, что есть в сводке ниже. Если данных для ответа недостаточно — честно скажи об этом
- Если пользователь спрашивает "могу ли я купить X за N рублей" — проанализируй: остаток после обязательных расходов, текущий баланс счетов, долги по кредитке, и дай обоснованный ответ
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

    const reply = await openRouterChat(messages, query, 0.8);
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
