import { help } from '../lib/messages.js';

export function registerHelp(bot) {
  bot.help((ctx) => ctx.replyWithHTML(help));
  bot.command('commands', (ctx) => ctx.replyWithHTML(help));
}
