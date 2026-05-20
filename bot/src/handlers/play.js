import { Markup } from 'telegraf';
import { config } from '../config.js';

export function registerPlay(bot) {
  bot.command('play', (ctx) =>
    ctx.reply(
      'Engine started. Open the garage:',
      Markup.inlineKeyboard([
        Markup.button.webApp('🚗 Open Lada Racing', config.miniAppUrl),
      ]),
    ),
  );
}
