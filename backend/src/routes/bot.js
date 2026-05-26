/**
 * Telegram Bot webhook handler.
 *
 * Telegram delivers updates to POST /api/bot
 * Register the webhook once with:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-backend.com/api/bot&secret_token=<BOT_WEBHOOK_SECRET>"
 * Or set TELEGRAM_WEBHOOK_URL in the environment and the server will register
 * it automatically on boot (see src/index.js).
 */
import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

const APP_URL = 'https://lada-car-racing.netlify.app';

async function tgCall(method, body) {
  if (!config.telegram.botToken) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN not set — skipping API call');
    return null;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

// POST /api/bot  — receives all Telegram updates
router.post('/', async (req, res) => {
  // Validate the secret token Telegram sends in the header (if configured)
  const secret = config.telegram.webhookSecret;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Always respond 200 immediately so Telegram doesn't retry
  res.json({ ok: true });

  try {
    const update = req.body;
    const msg    = update?.message;
    if (!msg) return;

    const text = (msg.text || '').trim();
    if (!text.startsWith('/start')) return;

    await tgCall('sendMessage', {
      chat_id: msg.chat.id,
      text: '🚗 *Welcome to Lada Car Racing!*\n\nSoviet Steel\\. TON Speed\\. No Brakes\\.',
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🏁 Play Now',
            web_app: { url: APP_URL },
          },
        ]],
      },
    });
  } catch (err) {
    console.error('[bot] failed to handle update:', err);
  }
});

export default router;
