/**
 * Telegram message templates. All return HTML strings (use `parse_mode: 'HTML'`).
 *
 * Tone: Russian-roads racing-game humour. Light theming — birch trees,
 * potholes, babushkas — without being heavy-handed.
 */
import { formatLada, displayName, shortAddress, escapeHtml } from './format.js';

export const welcome = (firstName) => `
<b>Privet, ${escapeHtml(firstName)}!</b>

Welcome to <b>Lada Car Racing</b> — race genuine Soviet steel down genuine pothole-ridden Russian roads.

🚗  Deposit Lada tokens, pick an opponent, dodge the potholes.
🏆  Winner takes 95% of the pot. The house pockets 5% (someone has to fix those potholes).

Tap <b>Open Lada Racing</b> to fire up the engine.
`.trim();

export const help = `
<b>Lada Car Racing — commands</b>

/play         Open the Mini App
/stats        Your wins, losses, and total LADA won
/leaderboard  Top racers this week
/help         This message

Race lobbies and live race notifications arrive automatically once you've played at least once.
`.trim();

// ───── /stats ────────────────────────────────────────────────────────
export const statsNotLinked = `
You haven't linked a wallet yet, comrade. Tap /play, connect your TON wallet inside the Mini App, and I'll start tracking your races.
`.trim();

export const statsFor = (player) => {
  const s = player.stats || {};
  const winrate = s.races_played > 0
    ? ((s.wins / s.races_played) * 100).toFixed(0) + '%'
    : '—';
  return `
<b>Your dashboard</b>

Wallet: <code>${shortAddress(player.address)}</code>
Races:  <b>${s.races_played ?? 0}</b>  ·  Wins: <b>${s.wins ?? 0}</b>  ·  Losses: <b>${s.losses ?? 0}</b>
Win rate: <b>${winrate}</b>

Total won:  <b>${formatLada(s.total_won)}</b> LADA
Total lost: <b>${formatLada(s.total_lost)}</b> LADA
  `.trim();
};

// ───── /leaderboard ──────────────────────────────────────────────────
export const leaderboardHeader = (period) => {
  const label = { all: 'all time', day: 'today', week: 'this week', month: 'this month' }[period] || period;
  return `<b>🏁 Top racers — ${label}</b>\n`;
};

export const leaderboardRow = (i, row) => {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
  const name = displayName(row);
  return `${medal} <b>${name}</b> — ${row.wins} wins · ${formatLada(row.totalWon)} LADA`;
};

export const leaderboardEmpty = `
The road is quiet — no settled races yet. Be the first to floor it: /play
`.trim();

// ───── Notifications (broadcast / DMs) ───────────────────────────────
export const lobbyCreatedFeed = ({ creatorName, stake, players, maxPlayers, lobbyId }) => `
🚗  <b>New lobby open</b>
Stake: <b>${formatLada(stake)}</b> LADA  ·  ${players}/${maxPlayers}
Host:  <b>${escapeHtml(creatorName || 'anonymous')}</b>

Open the app to join: /play
`.trim();

export const lobbyJoined = ({ opponentName, stake }) => `
🛞  <b>Opponent at the start line!</b>
${escapeHtml(opponentName || 'A challenger')} just joined your lobby (${formatLada(stake)} LADA).

Time to commit your secret — tap /play.
`.trim();

export const raceStarting = ({ raceId }) => `
🚦  <b>Race ${raceId} is on</b>

Reveal your secret inside the Mini App to decide the winner: /play
`.trim();

export const winnerMessage = ({ payout, opponentName }) => `
🏆  <b>Pobeda!</b>
You out-dodged ${escapeHtml(opponentName || 'the competition')} and took home <b>${formatLada(payout)}</b> LADA.

The babushkas approve. Want another go? /play
`.trim();

export const loserMessage = ({ winnerName, stake }) => `
💨  <b>The potholes won this time.</b>
${escapeHtml(winnerName || 'Your opponent')} took the pot (${formatLada(stake)} LADA gone).

Shake it off and try another race: /play
`.trim();

export const raceRefunded = ({ refundAmount }) => `
⌛  <b>Race refunded</b>
Reveal deadline passed. Your <b>${formatLada(refundAmount)}</b> LADA is on its way back.

Pick a fresh opponent: /play
`.trim();
