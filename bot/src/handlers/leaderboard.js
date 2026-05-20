import { api } from '../lib/api.js';
import {
  leaderboardHeader,
  leaderboardRow,
  leaderboardEmpty,
} from '../lib/messages.js';

export function registerLeaderboard(bot) {
  bot.command('leaderboard', async (ctx) => {
    // Optional period arg: /leaderboard week
    const arg = (ctx.message.text.split(/\s+/)[1] || 'week').toLowerCase();
    const period = ['all', 'day', 'week', 'month'].includes(arg) ? arg : 'week';

    try {
      const { rows } = await api.getLeaderboard({ period, limit: 10 });
      if (!rows.length) return ctx.replyWithHTML(leaderboardEmpty);

      const lines = [leaderboardHeader(period), ...rows.map((r, i) => leaderboardRow(i, r))];
      await ctx.replyWithHTML(lines.join('\n'));
    } catch (e) {
      console.error('[/leaderboard]', e);
      await ctx.reply('Could not reach the timing tower — try again shortly.');
    }
  });
}
