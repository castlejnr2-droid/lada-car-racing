export function registerHelp(bot) {
  bot.help((ctx) =>
    ctx.reply(
      [
        'Lada Car Racing — race classic Ladas down Russian roads.',
        '',
        'Deposit Lada tokens to enter a lobby. Winner gets 95% of the pot.',
        'Use /start to open the game.',
      ].join('\n'),
    ),
  );
}
