import { api } from './client.js';

export const upsertPlayer = (body) =>
  api('/api/players', { method: 'POST', body: JSON.stringify(body) });

export const fetchPlayerByTelegram = (telegramId) =>
  api(`/api/players/by-telegram/${encodeURIComponent(telegramId)}`);
