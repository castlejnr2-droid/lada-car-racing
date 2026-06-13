import { api } from './client.js';

export const fetchLeaderboard = (sort = 'wins') =>
  api(`/api/leaderboard?sort=${sort}&limit=50`);
