import { api } from './client.js';

export const fetchRace = (id) => api(`/api/races/${encodeURIComponent(id)}`);
export const fetchRaceByChain = (onChainId) =>
  api(`/api/races/by-chain/${encodeURIComponent(onChainId)}`);
