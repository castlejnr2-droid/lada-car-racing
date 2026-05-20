/**
 * Thin backend API client. Wraps fetch with the base URL, JSON handling,
 * and (optionally) the admin token header.
 */
import { config } from '../config.js';

class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const url = `${config.backend.url}${path}`;
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (config.backend.adminToken) headers['X-Admin-Token'] = config.backend.adminToken;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export const api = {
  // /api/players
  getPlayerByTelegramId: (telegramId) =>
    request(`/api/players/by-telegram/${encodeURIComponent(telegramId)}`),
  getPlayer:       (address)    => request(`/api/players/${encodeURIComponent(address)}`),
  getPlayerRaces:  (address)    => request(`/api/players/${encodeURIComponent(address)}/races`),
  getBalance:      (address)    => request(`/api/players/${encodeURIComponent(address)}/balance`),

  // /api/leaderboard
  getLeaderboard:  ({ period = 'all', limit = 10 } = {}) =>
    request(`/api/leaderboard?period=${period}&limit=${limit}`),

  // /api/lobbies
  getOpenLobbies:  () => request(`/api/lobbies`),

  // /api/races
  getRace:         (id) => request(`/api/races/${encodeURIComponent(id)}`),
};

export { ApiError };
