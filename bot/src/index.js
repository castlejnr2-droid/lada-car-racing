import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { registerStart } from './handlers/start.js';
import { registerHelp } from './handlers/help.js';
import { startNotificationServer } from './handlers/notifications.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Telegraf(token);

registerStart(bot);
registerHelp(bot);

bot.launch().then(() => console.log('[lada-bot] launched'));
startNotificationServer(bot);

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
