const { Telegraf, Markup } = require('telegraf');

let bot = null;

function createBot(token, appUrl) {
  if (!token || token === 'your_bot_token_from_botfather') {
    console.log('⚠️  BOT_TOKEN not configured. Bot disabled.');
    return null;
  }

  bot = new Telegraf(token);

  bot.start((ctx) => {
    const name = ctx.from.first_name || 'друг';
    ctx.reply(
      `👋 Привет, ${name}!\n\n` +
      `Я — FinanceBot, твой личный финансовый помощник.\n\n` +
      `📊 Отслеживай доходы и расходы\n` +
      `📈 Смотри аналитику\n` +
      `🔔 Управляй обязательными платежами\n` +
      `💾 Все данные хранятся в PostgreSQL\n\n` +
      `Нажми кнопку ниже, чтобы открыть Mini App:`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📱 Открыть FinanceBot', appUrl),
      ])
    );
  });

  bot.command('menu', (ctx) => {
    ctx.reply(
      '📋 Меню FinanceBot:',
      Markup.inlineKeyboard([
        [Markup.button.webApp('📊 Дашборд', appUrl)],
        [Markup.button.webApp('📈 Доходы', `${appUrl}?page=income`)],
        [Markup.button.webApp('📉 Расходы', `${appUrl}?page=expenses`)],
        [Markup.button.webApp('📋 Аналитика', `${appUrl}?page=analytics`)],
        [Markup.button.webApp('⚙️ Настройки', `${appUrl}?page=settings`)],
      ])
    );
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      'ℹ️ *FinanceBot — помощь*\n\n' +
      '*/start* — приветствие и запуск Mini App\n' +
      '*/menu* — быстрое меню по разделам\n' +
      '*/help* — эта справка\n\n' +
      '*Mini App:*\n' +
      'Открой приложение через кнопку в /start, ' +
      'чтобы управлять финансами в удобном интерфейсе.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}

async function launchBot() {
  if (!bot) return;
  try {
    await bot.launch();
    console.log('🤖 Telegram bot started (long polling)');
  } catch (err) {
    console.error('Failed to start bot:', err.message);
  }
}

function stopBot() {
  if (bot) {
    bot.stop();
    console.log('🤖 Bot stopped');
  }
}

module.exports = { createBot, launchBot, stopBot };
