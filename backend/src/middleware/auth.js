import { verifyInitData } from '../services/telegramAuth.js';

/**
 * Express middleware: require a valid Telegram Mini App initData header.
 * The frontend sends it as `X-Telegram-Init-Data`.
 */
export function requireTelegram(req, res, next) {
  const initData = req.header('X-Telegram-Init-Data');
  if (!initData || !verifyInitData(initData)) {
    return res.status(401).json({ error: 'Invalid Telegram initData' });
  }
  const params = new URLSearchParams(initData);
  req.telegramUser = JSON.parse(params.get('user') || '{}');
  next();
}
