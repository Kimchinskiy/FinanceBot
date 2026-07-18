// ===================================================================
// FinanceBot — bot.js  (Telegram-бот v2: работает с auth-бэкендом)
// Бот сам логинится от лица Telegram-пользователя и показывает
// баланс/сводку/цели/AI-совет прямо в чате (не ведёт на сломанный веб).
// ===================================================================
const { Telegraf, Markup } = require('telegraf');
const { upsertUserByTg, signToken } = require('./auth');

let bot = null;
let query = null;
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const tokens = new Map();   // chatId -> JWT
const states = new Map();   // chatId -> 'income' | 'expense'

function createBot(token, appUrl, db) {
  if (!token || token === 'your_bot_token_from_botfather') {
    console.log('⚠️  BOT_TOKEN not configured. Bot disabled.');
    return null;
  }
  query = db.query;
  bot = new Telegraf(token);

  // Получить (или создать) токен для пользователя Telegram
  async function getToken(ctx) {
    const chatId = ctx.chat.id;
    if (tokens.has(chatId)) return tokens.get(chatId);
    const u = await upsertUserByTg(query, ctx.from.id, ctx.from.first_name, ctx.from.username);
    const tk = signToken(u);
    tokens.set(chatId, tk);
    return tk;
  }

  async function api(path, token, method = 'GET', body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  const rub = (n) => (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';

  const mainMenu = () => Markup.inlineKeyboard([
    [Markup.button.callback('💰 Баланс', 'balance')],
    [Markup.button.callback('➕ Доход', 'inc'), Markup.button.callback('➖ Расход', 'exp')],
    [Markup.button.callback('🎯 Цели', 'goals'), Markup.button.callback('💡 AI-совет', 'advice')],
    [Markup.button.callback('📊 Сводка за месяц', 'summary')],
  ]);

  bot.start(async (ctx) => {
    const name = ctx.from.first_name || 'друг';
    await ctx.reply(
      `👋 Привет, ${name}!\n\nЯ — FinanceBot, твой финансовый помощник.\n` +
      `Нажми кнопку, чтобы увидеть результат прямо здесь:`,
      mainMenu()
    );
  });

  bot.command('menu', (ctx) => ctx.reply('📋 Меню:', mainMenu()));
  bot.command('help', (ctx) => ctx.reply(
    'ℹ️ *FinanceBot — помощь*\n\n' +
    '/start — запуск и меню\n/menu — главное меню\n/help — эта справка\n\n' +
    'Кнопки: баланс, добавить доход/расход, цели, AI-совет, сводка.',
    { parse_mode: 'Markdown' }
  ));

  // Баланс
  bot.action('balance', async (ctx) => {
    try {
      const tk = await getToken(ctx);
      const { total } = await api('/api/accounts/total', tk);
      await ctx.editMessageText(`💰 Твой баланс: *${rub(total)}*`, mainMenu());
    } catch (e) { await ctx.reply('Ошибка получения баланса'); }
    await ctx.answerCbQuery();
  });

  // Доход — запрашиваем сумму
  bot.action('inc', async (ctx) => {
    states.set(ctx.chat.id, 'income');
    await ctx.editMessageText('➕ Введите сумму дохода (например: 50000):');
    await ctx.answerCbQuery();
  });

  // Расход — запрашиваем сумму
  bot.action('exp', async (ctx) => {
    states.set(ctx.chat.id, 'expense');
    await ctx.editMessageText('➖ Введите сумму расхода (например: 350):');
    await ctx.answerCbQuery();
  });

  // Цели
  bot.action('goals', async (ctx) => {
    try {
      const tk = await getToken(ctx);
      const goals = await api('/api/goals', tk);
      if (!goals.length) { await ctx.editMessageText('🎯 Пока нет целей. Добавьте их в приложении.', mainMenu()); }
      else {
        const text = goals.map(g => {
          const pct = Math.round((g.current_amount / g.target_amount) * 100);
          return `🎯 *${g.title}*\n   ${rub(g.current_amount)} из ${rub(g.target_amount)} (${pct}%)`;
        }).join('\n\n');
        await ctx.editMessageText('🎯 Твои цели:\n\n' + text, mainMenu());
      }
    } catch (e) { await ctx.reply('Ошибка загрузки целей'); }
    await ctx.answerCbQuery();
  });

  // AI-совет
  bot.action('advice', async (ctx) => {
    try {
      const tk = await getToken(ctx);
      const { tips, source } = await api('/api/ai/advice', tk, 'POST', {});
      const header = source === 'ai' ? '💡 AI-совет:' : '💡 Совет (базовый режим):';
      const text = tips.map(t => `• ${t}`).join('\n');
      await ctx.editMessageText(header + '\n\n' + text, mainMenu());
    } catch (e) { await ctx.reply('Ошибка получения совета'); }
    await ctx.answerCbQuery();
  });

  // Сводка за месяц
  bot.action('summary', async (ctx) => {
    try {
      const tk = await getToken(ctx);
      const [inc, exp, mand, acc] = await Promise.all([
        api('/api/incomes', tk), api('/api/expenses', tk),
        api('/api/mandatory', tk), api('/api/accounts/total', tk),
      ]);
      const month = new Date().toISOString().slice(0, 7);
      const mInc = inc.filter(i => i.datetime.startsWith(month)).reduce((s, i) => s + Number(i.amount), 0);
      const mExp = exp.filter(e => e.datetime.startsWith(month)).reduce((s, e) => s + Number(e.amount), 0);
      const pending = mand.filter(m => m.status !== 'paid');
      let text = `📊 *Сводка за месяц*\n\n`;
      text += `💰 Баланс: ${rub(acc.total)}\n`;
      text += `📈 Доходы: ${rub(mInc)}\n`;
      text += `📉 Расходы: ${rub(mExp)}\n`;
      text += `⚖️ Профит: ${rub(mInc - mExp)}\n`;
      if (pending.length) text += `\n⏰ Неоплачено: ${pending.length} платежей на ${rub(pending.reduce((s, m) => s + Number(m.amount), 0))}`;
      await ctx.editMessageText(text, mainMenu());
    } catch (e) { await ctx.reply('Ошибка загрузки сводки'); }
    await ctx.answerCbQuery();
  });

  // Обработка ввода суммы (доход/расход)
  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const st = states.get(chatId);
    if (!st) return; // не в режиме ввода — игнорируем
    states.delete(chatId);
    const amount = parseFloat(ctx.message.text.replace(',', '.'));
    if (!amount || amount <= 0) { return ctx.reply('❌ Неверная сумма. Попробуйте ещё раз.'); }
    try {
      const tk = await getToken(ctx);
      const settings = await api('/api/settings', tk);
      const cats = st === 'income' ? settings.income_categories : settings.expense_categories;
      const category = Array.isArray(cats) && cats.length ? cats[0] : (st === 'income' ? 'Зарплата' : 'Еда');
      await api(st === 'income' ? '/api/incomes' : '/api/expenses', tk, 'POST',
        { amount, category, description: '' });
      const { total } = await api('/api/accounts/total', tk);
      await ctx.reply(`✅ ${st === 'income' ? 'Доход' : 'Расход'} ${rub(amount)} добавлен.\n💰 Баланс: ${rub(total)}`);
    } catch (e) {
      await ctx.reply('❌ Не удалось сохранить. Попробуйте позже.');
    }
  });

  bot.catch((err) => console.error('Bot error:', err.message));
  return bot;
}

async function launchBot() {
  if (!bot) return;
  try { await bot.launch(); console.log('🤖 Telegram bot started (long polling)'); }
  catch (err) { console.error('Failed to start bot:', err.message); }
}

function stopBot() {
  if (bot) { bot.stop(); console.log('🤖 Bot stopped'); }
}

module.exports = { createBot, launchBot, stopBot };
