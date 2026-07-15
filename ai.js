// ===================================================================
// FinanceBot — ai.js  (AI-рекомендации и чат через OpenRouter)
// Ключ OPENROUTER_API_KEY хранится ТОЛЬКО на сервере.
// Если ключ не задан или LLM недоступен — deterministic rule-based фолбэк.
// В LLM уходят ТОЛЬКО агрегированные/анонимные суммы и категории (без ФИО/PII).
// ===================================================================
const express = require('express');
const router = express.Router();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const APP_URL = process.env.APP_URL || 'https://maz.stormkhv.ru';

function rub(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

// Вызов OpenRouter chat completions. Возвращает текст или null при ошибке/отсутствии ключа.
async function openRouterChat(messages, temperature = 0.7) {
  if (!OPENROUTER_KEY) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
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
async function buildSummary(pool, userId) {
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = new Date(); threeAgo.setMonth(threeAgo.getMonth() - 3);

  const groupSql = (table) => `
    SELECT category, COALESCE(SUM(amount),0) AS total
    FROM ${table} WHERE user_id=$1 AND datetime >= $2 GROUP BY category ORDER BY total DESC`;

  const [inc, exp, mand, goals] = await Promise.all([
    pool.query(groupSql('incomes'), [userId, threeAgo.toISOString()]),
    pool.query(groupSql('expenses'), [userId, threeAgo.toISOString()]),
    pool.query('SELECT name, amount, type, day, status FROM mandatory_payments WHERE user_id=$1', [userId]),
    pool.query('SELECT title, target_amount, current_amount, deadline FROM goals WHERE user_id=$1', [userId]),
  ]);

  // Расходы текущего месяца vs среднего за 3 месяца по категориям
  const curMonth = await pool.query(groupSql('expenses'), [userId, monthAgo.toISOString()]);

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
  return summary;
}

// Rule-based советы (детерминированные, без LLM)
async function ruleBasedAdvice(pool, userId) {
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const threeAgo = new Date(); threeAgo.setMonth(threeAgo.getMonth() - 3);

  const cur = await pool.query(
    `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE user_id=$1 AND datetime >= $2 GROUP BY category`, [userId, monthAgo.toISOString()]);
  const prev = await pool.query(
    `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE user_id=$1 AND datetime >= $2 AND datetime < $3 GROUP BY category`,
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

  const goals = await pool.query('SELECT title, target_amount, current_amount FROM goals WHERE user_id=$1', [userId]);
  goals.rows.forEach(g => {
    const pct = Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100);
    if (pct < 100) tips.push(`По цели «${g.title}» накоплено ${pct}%. Продолжайте регулярно откладывать — это формирует привычку копить.`);
  });

  const mand = await pool.query("SELECT COUNT(*) AS c FROM mandatory_payments WHERE user_id=$1 AND status<>'paid'", [userId]);
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
  const pool = req.app.locals.pool;
  try {
    const summary = await buildSummary(pool, req.userId);
    const aiText = await openRouterChat([
      { role: 'system', content: 'Ты — финансовый ассистент. Дай 3-5 конкретных, дружелюбных и практичных совета по управлению личными финансами на основе сводки. Каждый совет с новой строки, без нумерации и без заголовков. Пиши на русском, кратко.' },
      { role: 'user', content: summary },
    ]);
    if (aiText) {
      const tips = aiText.split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
      return res.json({ tips, source: 'ai' });
    }
    const tips = await ruleBasedAdvice(pool, req.userId);
    res.json({ tips, source: 'rules' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — диалог с ассистентом
router.post('/chat', async (req, res) => {
  const pool = req.app.locals.pool;
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Пустое сообщение' });
  try {
    const summary = await buildSummary(pool, req.userId);
    const messages = [
      { role: 'system', content: 'Ты — персональный финансовый помощник в приложении FinanceBot. Отвечай на русском, дружелюбно и по делу. Учитывай финансовую сводку пользователя, но не выдумывай точные цифры, которых нет в сводке. Помогай сокращать расходы, копить и гасить долги.\n\nСводка пользователя:\n' + summary },
    ];
    if (Array.isArray(history)) {
      history.slice(-10).forEach(h => {
        if (h.role && h.content) messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
      });
    }
    messages.push({ role: 'user', content: message });

    const reply = await openRouterChat(messages, 0.8);
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
