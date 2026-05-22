import { api } from './client.js';

export const fetchLobbies = ()         => api('/api/lobbies');
export const createLobby  = (body)     => api('/api/lobbies', {
  method: 'POST', body: JSON.stringify(body),
});
export const joinLobby = (id, address, username) => api(`/api/lobbies/${id}/join`, {
  method: 'POST', body: JSON.stringify({ address, username: username || null }),
});
export const cancelLobby = (id, address) => api(`/api/lobbies/${id}`, {
  method: 'DELETE', body: JSON.stringify({ address }),
});
