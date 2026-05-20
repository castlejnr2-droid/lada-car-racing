import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { registerStart } from './handlers/start.js';
import { registerPlay } from './handlers/play.js';
import { registerStats } from './handlers/stats.js';
import { registerLeaderboard } from './handlers/leaderboard.js';
import { registerHelp } from './handlers/help.js';
import { startNotificationServer } from './handlers/notifications.js';

const bot = new Telegraf(config.telegram.botToken);

// Catch unhandled handler errors so a single bad message doesn't crash the bot
bot.catch((err, ctx) => {
  console.error(`[lada-bot] error in update ${ctx.update.update_id}:`, err);
});

registerStart(bot);
registerPlay(bot);
registerStats(bot);
registerLeaderboard(bot);
registerHelp(bot);

// Register the command list so Telegram's slash-command autocomplete shows them
bot.telegram.setMyCommands([
  { command: 'play',        description: 'Open the Mini App' },
  { command: 'stats',       description: 'Your wins, losses, and winnings' },
  { command: 'leaderboard', description: 'Top racers' },
  { command: 'help',        description: 'Show available commands' },
]).catch((e) => console.warn('[lada-bot] setMyCommands failed:', e.message));

bot.launch().then(() => console.log('[lada-bot] launched'));

startNotificationServer(bot);

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
