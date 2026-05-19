import { api } from './client.js';

export const fetchLobbies = () => api('/lobbies');
export const createLobby  = (body) => api('/lobbies', { method: 'POST', body: JSON.stringify(body) });
export const joinLobby    = (id)   => api(`/lobbies/${id}/join`, { method: 'POST' });
