import { Markup } from 'telegraf';
import { welcome } from '../lib/messages.js';

export function registerStart(bot) {
  bot.start((ctx) =>
    ctx.reply(
      welcome(ctx.from.first_name),
      Markup.inlineKeyboard([
        Markup.button.webApp('Open Lada Racing', process.env.MINI_APP_URL),
      ]),
    ),
  );
}
