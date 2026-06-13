import { api } from './client.js';

export const fetchRace = (id) => api(`/api/races/${encodeURIComponent(id)}`);
export const fetchRaceByChain = (onChainId) =>
  api(`/api/races/by-chain/${encodeURIComponent(onChainId)}`);

export const fetchSettledRaces = (limit = 20) =>
  api(`/api/races?state=settled&limit=${limit}`);
