import { api } from './client.js';

export const fetchLeaderboard = (period = 'week') =>
  api(`/api/leaderboard?period=${period}&limit=20`);
