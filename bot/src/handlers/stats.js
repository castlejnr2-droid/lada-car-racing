import { Markup } from 'telegraf';
import { api, ApiError } from '../lib/api.js';
import { statsFor, statsNotLinked } from '../lib/messages.js';
import { config } from '../config.js';

export function registerStats(bot) {
  bot.command('stats', async (ctx) => {
    try {
      const player = await api.getPlayerByTelegramId(ctx.from.id);
      await ctx.replyWithHTML(statsFor(player));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return ctx.replyWithHTML(
          statsNotLinked,
          Markup.inlineKeyboard([
            Markup.button.webApp('🚗 Open Lada Racing', config.miniAppUrl),
          ]),
        );
      }
      console.error('[/stats]', e);
      await ctx.reply('Hit a pothole fetching your stats — try again in a moment.');
    }
  });
}
