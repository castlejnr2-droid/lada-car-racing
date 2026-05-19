/**
 * Verifies Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export function verifyInitData(initData) {
  if (!config.telegram.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.telegram.botToken)
    .digest();

  const computed = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return computed === hash;
}
