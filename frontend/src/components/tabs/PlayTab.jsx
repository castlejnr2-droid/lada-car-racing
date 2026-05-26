import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { fetchLobbies, createLobby, joinLobby } from '../../api/lobbies.js';
import { fetchRace } from '../../api/races.js';
import { useMainButton, haptic, tgUser } from '../../lib/telegram.js';
import { formatLada, ladaToNano, shortAddress } from '../../lib/format.js';

const PLAYER_OPTIONS = [2, 3, 4, 5];

export default function PlayTab({ balance = null }) {
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [stake, setStake] = useState('10');
  const [minPlayers, setMinPlayers] = useState(2);
  const [sending, setSending] = useState(false);
  const [myPendingLobbyId, setMyPendingLobbyId] = useState(null);
  const address = useTonAddress();
  const navigate = useNavigate();
  const username = tgUser()?.username || tgUser()?.first_name || null;

  const stakeNano = ladaToNano(stake || '0');
  const balanceOk = balance === null || stakeNano <= balance;
  const stakeValid = stakeNano > 0n && balanceOk;

  // Poll for race start when the creator is waiting for players to join
  useEffect(() => {
    if (!myPendingLobbyId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const r = await fetchRace(myPendingLobbyId);
        if (!cancelled && r) {
          clearInterval(timer);
          setMyPendingLobbyId(null);
          navigate(`/race/${myPendingLobbyId}`);
        }
      } catch {
        // race not yet created — keep polling
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [myPendingLobbyId, navigate]);

  async function refresh() {
    setLoading(true);
    try { setLobbies(await fetchLobbies()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (creating) return () => {};
    if (!address) return () => {};
    return useMainButton('Create lobby', () => {
      haptic.tap();
      setCreating(true);
    });
  }, [creating, address]);

  async function handleCreate() {
    if (!stakeValid) return;
    setSending(true);
    try {
      haptic.medium();
      const lobby = await createLobby({
        stake: stakeNano.toString(),
        creator: address,
        username,
        minPlayers,
        maxPlayers: 5,
      });
      setCreating(false);
      haptic.success();
      setMyPendingLobbyId(lobby.id);
      refresh();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setSending(false);
    }
  }

  async function handleJoin(lobby) {
    setSending(true);
    try {
      haptic.medium();
      const result = await joinLobby(lobby.id, address, username);
      haptic.success();
      if (result?.raceStarted) {
        navigate(`/race/${lobby.id}`);
      } else {
        refresh();
      }
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setSending(false);
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
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Wager (LADA)</span>
              {balance !== null && (
                <span style={{ color: 'var(--accent-2)' }}>
                  Balance: {Number(balance / 1_000_000_000n).toLocaleString()} LADA
                </span>
              )}
            </label>
            <input
              type="number" inputMode="decimal" min="0" step="0.1"
              value={stake} onChange={(e) => setStake(e.target.value)}
              autoFocus
              style={{ borderColor: !balanceOk ? 'var(--error)' : undefined }}
            />
            {!balanceOk && (
              <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>
                Insufficient balance
              </div>
            )}
          </div>

          <div className="field">
            <label>Start race when this many players join</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {PLAYER_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn--small ${minPlayers === n ? '' : 'btn--ghost'}`}
                  style={{ flex: 1 }}
                  onClick={() => { haptic.select(); setMinPlayers(n); }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 4 }}>
              Max 5 players per lobby. The race auto-starts once the chosen minimum is reached.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost" disabled={sending} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn" disabled={!stakeValid || sending} onClick={handleCreate}>
              {sending ? '…' : 'Create lobby'}
            </button>
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
                host {shortAddress(l.creator)} · {l.players}/{l.minPlayers ?? 2}
                {l.minPlayers !== l.maxPlayers && ` (up to ${l.maxPlayers})`}
              </div>
            </div>
            <button
              className="btn btn--small"
              onClick={() => handleJoin(l)}
              disabled={l.creator === address || l.players >= l.maxPlayers || sending}
            >
              {l.creator === address ? 'Yours' : 'Join'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
