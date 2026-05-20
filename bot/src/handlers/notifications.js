/**
 * HTTP server the backend (or indexer) pushes notifications to.
 *
 * The bot doesn't poll — it relies on the backend, which is the only thing
 * that knows when an off-chain lobby filled up or an on-chain race settled,
 * to fan events out to the right Telegram users.
 *
 * Endpoints (all expect JSON):
 *
 *   POST /notify/lobby-created   { creatorName, stake, players, maxPlayers,
 *                                  lobbyId, broadcast? }
 *   POST /notify/lobby-joined    { creatorTelegramId, opponentName, stake,
 *                                  lobbyId }
 *   POST /notify/race-starting   { telegramIds: [...], raceId }
 *   POST /notify/race-settled    { winnerTelegramId, loserTelegramId,
 *                                  winnerName, loserName, payout, stake,
 *                                  raceId }
 *   POST /notify/race-refunded   { telegramIds: [...], refundAmount, raceId }
 *
 * Auth: if NOTIFY_TOKEN is set, all requests must include it in
 *   X-Notify-Token. If unset, the server accepts any caller (dev only).
 */
import http from 'node:http';
import { config } from '../config.js';
import {
  lobbyCreatedFeed,
  lobbyJoined,
  raceStarting,
  winnerMessage,
  loserMessage,
  raceRefunded,
} from '../lib/messages.js';

export function startNotificationServer(bot) {
  const server = http.createServer((req, res) => handleRequest(bot, req, res));
  server.listen(config.notify.port, () =>
    console.log(`[lada-bot] notify server on :${config.notify.port}`),
  );
  return server;
}

async function handleRequest(bot, req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' });
  if (config.notify.token && req.headers['x-notify-token'] !== config.notify.token) {
    return reply(res, 401, { error: 'bad notify token' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return reply(res, 400, { error: 'bad json: ' + e.message });
  }

  try {
    const handler = ROUTES[req.url];
    if (!handler) return reply(res, 404, { error: `unknown route ${req.url}` });
    const result = await handler(bot, body);
    reply(res, 200, { ok: true, ...result });
  } catch (e) {
    console.error('[notify]', req.url, e);
    reply(res, 500, { error: e.message });
  }
}

// ───── Route handlers ────────────────────────────────────────────────

const ROUTES = {
  '/notify/lobby-created':  notifyLobbyCreated,
  '/notify/lobby-joined':   notifyLobbyJoined,
  '/notify/race-starting':  notifyRaceStarting,
  '/notify/race-settled':   notifyRaceSettled,
  '/notify/race-refunded':  notifyRaceRefunded,
};

async function notifyLobbyCreated(bot, data) {
  // Broadcast to the public lobbies channel if configured. We never DM about
  // lobby creation — the creator doesn't need to be notified of their own
  // action, and DMing strangers would be spam.
  if (!config.lobbiesChannelId) return { skipped: 'no LOBBIES_CHANNEL_ID' };
  await bot.telegram.sendMessage(config.lobbiesChannelId, lobbyCreatedFeed(data), {
    parse_mode: 'HTML',
  });
  return { sent: 1 };
}

async function notifyLobbyJoined(bot, { creatorTelegramId, ...data }) {
  if (!creatorTelegramId) throw new Error('creatorTelegramId required');
  await bot.telegram.sendMessage(creatorTelegramId, lobbyJoined(data), {
    parse_mode: 'HTML',
  });
  return { sent: 1 };
}

async function notifyRaceStarting(bot, { telegramIds = [], raceId }) {
  const sent = await sendAll(bot, telegramIds, raceStarting({ raceId }));
  return { sent };
}

async function notifyRaceSettled(bot, data) {
  const {
    winnerTelegramId, loserTelegramId,
    winnerName, loserName,
    payout, stake,
  } = data;

  let sent = 0;
  if (winnerTelegramId) {
    await bot.telegram.sendMessage(
      winnerTelegramId,
      winnerMessage({ payout, opponentName: loserName }),
      { parse_mode: 'HTML' },
    );
    sent++;
  }
  if (loserTelegramId) {
    await bot.telegram.sendMessage(
      loserTelegramId,
      loserMessage({ winnerName, stake }),
      { parse_mode: 'HTML' },
    );
    sent++;
  }
  return { sent };
}

async function notifyRaceRefunded(bot, { telegramIds = [], refundAmount }) {
  const sent = await sendAll(bot, telegramIds, raceRefunded({ refundAmount }));
  return { sent };
}

// ───── Helpers ───────────────────────────────────────────────────────

async function sendAll(bot, ids, text) {
  let n = 0;
  for (const id of ids) {
    if (!id) continue;
    try {
      await bot.telegram.sendMessage(id, text, { parse_mode: 'HTML' });
      n++;
    } catch (e) {
      // common: user blocked the bot, or the bot can't DM them yet
      console.warn(`[notify] could not DM ${id}: ${e.message}`);
    }
  }
  return n;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end',  () => {
      if (!chunks) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
