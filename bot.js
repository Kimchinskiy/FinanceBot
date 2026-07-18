// ===================================================================
// FinanceBot — bot.js  (Telegram-бот v3: режим уведомлений + команд)
// Бот НЕ ведёт полноценный учёт в чате и не делает упор на веб-приложение.
// Он присылает напоминания об обязательных платежах и отвечает на команды:
//   /balance  /платежи  /сводка  /помощь
// ===================================================================
const { Telegraf, Markup } = require('telegraf');
const { upsertUserByTg, signToken } = require('./auth');

let bot = null;
let query = null;
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const tokens = new Map();     // chatId  -> JWT
const chatByUser = new Map(); // userId  -> chatId  (для рассылки напоминаний)

// За сколько дней до списания напоминать
const REMIND_BEFORE_DAYS = parseInt(process.env.REMIND_BEFORE_DAYS || '3', 10);

function createBot(token, appUrl, db) {
  if (!token || token === 'your_bot_token_from_botfather') {
    console.log('⚠️  BOT_TOKEN not configured. Bot disabled.');
    return null;
  }
  query = db.query;
  bot = new Telegraf(token);

  async function getToken(ctx) {
    const chatId = ctx.chat.id;
    if (tokens.has(chatId)) return tokens.get(chatId);
    const u = await upsertUserByTg(query, ctx.from.id, ctx.from.first_name, ctx.from.username);
    const tk = signToken(u);
    tokens.set(chatId, tk);
    chatByUser.set(u.id, chatId);
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

  const helpText =
    'ℹ️ *FinanceBot — команды*\n\n' +
    '/balance — текущий баланс\n' +
    '/платежи — предстоящие обязательные платежи\n' +
    '/сводка — доходы и расходы за месяц\n' +
    '/помощь — справка\n\n' +
    '🔔 Я сам пришлю напоминание, когда подойдёт срок очередного платежа.';

  const mainMenu = () => Markup.keyboard([
    ['💰 Баланс', '📅 Платежи'],
    ['📊 Сводка', 'ℹ️ Помощь'],
  ]).resize();

  bot.start(async (ctx) => {
    const name = ctx.from.first_name || 'друг';
    await ctx.reply(
      `👋 Привет, ${name}!\n\n` +
      `Я FinanceBot — буду напоминать о предстоящих платежах и показывать баланс по команде.\n` +
      `Основной учёт веди в веб-приложении, а здесь просто спрашивай:`,
      mainMenu()
    );
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
  });

  bot.command('help', (ctx) => ctx.reply(helpText, { parse_mode: 'Markdown' }));
  bot.command('помощь', (ctx) => ctx.reply(helpText, { parse_mode: 'Markdown' }));

  // /balance
  bot.command('balance', async (ctx) => {
    try {
      const tk = await getToken(ctx);
      const { spendable, invest, netWorth } = await api('/api/accounts/total', tk);
      await ctx.reply(
        `💰 *Баланс*\n\nДоступно: ${rub(spendable)}\nАктивы: ${rub(invest)}\nЧистый капитал: ${rub(netWorth)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) { await ctx.reply('Ошибка получения баланса'); }
  });

  // /платежи  /payments
  bot.command('платежи', showPayments);
  bot.command('payments', showPayments);
  async function showPayments(ctx) {
    try {
      const tk = await getToken(ctx);
      const mand = await api('/api/mandatory', tk);
      const pending = mand.filter(m => m.status !== 'paid');
      if (!pending.length) return ctx.reply('✅ Все обязательные платежи оплачены.');
      const text = pending
        .sort((a, b) => (a.day || 99) - (b.day || 99))
        .map(m => `• ${m.name}: *${rub(m.amount)}* — ${m.day ? m.day + ' числа' : 'разово'} (${typeLabel(m.type)})`)
        .join('\n');
      await ctx.reply('📅 *Предстоящие платежи:*\n\n' + text, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply('Ошибка загрузки платежей'); }
  }

  // /сводка  /summary
  bot.command('сводка', showSummary);
  bot.command('summary', showSummary);
  async function showSummary(ctx) {
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
      text += `💰 Баланс: ${rub(acc.netWorth)}\n`;
      text += `📈 Доходы: ${rub(mInc)}\n`;
      text += `📉 Расходы: ${rub(mExp)}\n`;
      text += `⚖️ Профит: ${rub(mInc - mExp)}\n`;
      if (pending.length) text += `\n⏰ Неоплачено: ${pending.length} платежей на ${rub(pending.reduce((s, m) => s + Number(m.amount), 0))}`;
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) { await ctx.reply('Ошибка загрузки сводки'); }
  }

  // Кнопки-команды (keyboard)
  bot.hears('💰 Баланс', (ctx) => runBalance(ctx));
  bot.hears('📅 Платежи', (ctx) => showPayments(ctx));
  bot.hears('📊 Сводка', (ctx) => showSummary(ctx));
  bot.hears('ℹ️ Помощь', (ctx) => ctx.reply(helpText, { parse_mode: 'Markdown' }));

  async function runBalance(ctx) {
    try {
      const tk = await getToken(ctx);
      const { spendable, invest, netWorth } = await api('/api/accounts/total', tk);
      await ctx.reply(
        `💰 *Баланс*\n\nДоступно: ${rub(spendable)}\nАктивы: ${rub(invest)}\nЧистый капитал: ${rub(netWorth)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) { await ctx.reply('Ошибка получения баланса'); }
  }

  bot.catch((err) => console.error('Bot error:', err.message));
  return bot;
}

function typeLabel(t) {
  return { monthly: 'ежемесячно', once: 'разово', yearly: 'ежегодно' }[t] || t;
}

/* ── Планировщик напоминаний (раз в сутки + при старте) ── */
let reminderTimer = null;

async function sendReminders() {
  if (!bot) return;
  try {
    const { query } = require('./db');
    // Все пользователи с неоплаченными платежами
    const users = await query(
      `SELECT DISTINCT u.id AS user_id
       FROM mandatory_payments m
       JOIN users u ON u.id = m.user_id
       WHERE m.status != 'paid'`
    );
    for (const { user_id } of users.rows) {
      const chatId = chatByUser.get(user_id);
      if (!chatId) continue; // пользователь ещё не писал боту — напоминать некуда
      const tk = tokens.get(chatId);
      if (!tk) continue;
      try {
        const mand = await apiRemind(`/api/mandatory`, tk);
        const today = new Date().getDate();
        const due = mand.filter(m => m.status !== 'paid' && m.day != null)
          .filter(m => {
            const diff = m.day - today;
            return diff >= 0 && diff <= REMIND_BEFORE_DAYS;
          });
        if (due.length) {
          const rub = (n) => (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
          const text = due.map(m =>
            `• ${m.name}: *${rub(m.amount)}* — ${m.day} числа (через ${m.day - today} ${plural(m.day - today)})`
          ).join('\n');
          await bot.telegram.sendMessage(chatId, '🔔 *Скоро списание:*', { parse_mode: 'Markdown' });
          await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
      } catch (e) { /* пропускаем пользователя */ }
    }
  } catch (e) {
    console.error('Reminder error:', e.message);
  }
}

async function apiRemind(path, token, method = 'GET') {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  const res = await fetch(BASE + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function plural(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b > 1 && b < 5) return 'дня';
  if (b === 1) return 'день';
  return 'дней';
}

function startReminders() {
  // Первый прогон через минуту после старта, далее раз в сутки
  setTimeout(sendReminders, 60 * 1000);
  reminderTimer = setInterval(sendReminders, 24 * 60 * 60 * 1000);
}

async function launchBot() {
  if (!bot) return;
  try { await bot.launch(); console.log('🤖 Telegram bot started (long polling)'); startReminders(); }
  catch (err) { console.error('Failed to start bot:', err.message); }
}

function stopBot() {
  if (reminderTimer) clearInterval(reminderTimer);
  if (bot) { bot.stop(); console.log('🤖 Bot stopped'); }
}

module.exports = { createBot, launchBot, stopBot };
