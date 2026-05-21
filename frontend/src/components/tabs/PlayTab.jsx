import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { fetchLobbies, createLobby, joinLobby } from '../../api/lobbies.js';
import { useMainButton, haptic } from '../../lib/telegram.js';
import { formatLada, ladaToNano, shortAddress } from '../../lib/format.js';

export default function PlayTab() {
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [stake, setStake] = useState('10');
  const address = useTonAddress();
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    try { setLobbies(await fetchLobbies()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  // MainButton: "Create lobby" by default, hides while opening the modal
  useEffect(() => {
    if (creating) return () => {};
    if (!address) return () => {};
    return useMainButton('Create lobby', () => {
      haptic.tap();
      setCreating(true);
    });
  }, [creating, address]);

  async function handleCreate() {
    try {
      haptic.medium();
      const lobby = await createLobby({
        stake: ladaToNano(stake).toString(),
        creator: address,
      });
      setCreating(false);
      haptic.success();
      // Stay on Play tab — the lobby now appears in the list. We could
      // also navigate straight into /race once both players are in.
      refresh();
      return lobby;
    } catch (e) {
      haptic.error();
      alert(e.message);
    }
  }

  async function handleJoin(lobby) {
    try {
      haptic.medium();
      await joinLobby(lobby.id, address);
      haptic.success();
      // The backend matches the lobby; refresh to get the on_chain_race_id
      // if it was assigned, then navigate.
      const updated = await fetchLobbies();
      const matched = updated.find((l) => l.id === lobby.id);
      // Navigate to the race screen — the screen waits for race state.
      navigate(`/race/${lobby.id}`);
    } catch (e) {
      haptic.error();
      alert(e.message);
    }
  }

  if (!address) {
    return (
      <div className="empty">
        <p style={{ marginBottom: 16 }}>
          Connect your TON wallet to start racing.
        </p>
        <TonConnectButton />
      </div>
    );
  }

  return (
    <div>
      {creating && (
        <div className="card">
          <div className="field">
            <label>Stake (LADA)</label>
            <input
              type="number" inputMode="decimal" min="0" step="0.1"
              value={stake} onChange={(e) => setStake(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn" onClick={handleCreate}>Create</button>
          </div>
        </div>
      )}

      <h2 style={{ fontSize: 13, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 8px' }}>
        Open lobbies
      </h2>

      {loading && <p className="empty">Loading…</p>}
      {!loading && lobbies.length === 0 && (
        <p className="empty">The road is quiet. Create the first lobby.</p>
      )}

      {lobbies.map((l) => (
        <div key={l.id} className="card">
          <div className="card__row">
            <div>
              <div className="card__title">{formatLada(l.stake)} LADA</div>
              <div className="card__meta">
                host {shortAddress(l.creator)} · {l.players}/{l.maxPlayers}
              </div>
            </div>
            <button
              className="btn btn--small"
              onClick={() => handleJoin(l)}
              disabled={l.creator === address}
            >
              {l.creator === address ? 'Yours' : 'Join'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
