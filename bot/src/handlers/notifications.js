import http from 'node:http';
import { lobbyJoined, raceStarting, winnerAnnounced } from '../lib/messages.js';

/**
 * Small HTTP server the backend uses to push messages.
 *
 *   POST /notify
 *     { type: 'lobbyJoined' | 'raceStarting' | 'winnerAnnounced',
 *       telegramId: 12345,
 *       data: { ... } }
 */
export function startNotificationServer(bot) {
  const port = process.env.NOTIFY_PORT || 3002;
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { type, telegramId, data } = JSON.parse(body);
      const text =
        type === 'lobbyJoined'     ? lobbyJoined(data)     :
        type === 'raceStarting'    ? raceStarting(data)    :
        type === 'winnerAnnounced' ? winnerAnnounced(data) :
        null;
      if (!text) {
        res.writeHead(400).end('unknown type');
        return;
      }
      await bot.telegram.sendMessage(telegramId, text);
      res.writeHead(200).end('ok');
    } catch (e) {
      console.error('[notify]', e);
      res.writeHead(500).end(e.message);
    }
  });
  server.listen(port, () => console.log(`[lada-bot] notify server on :${port}`));
}
