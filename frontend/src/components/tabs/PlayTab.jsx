import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { fetchLobbies, createLobby, joinLobby } from '../../api/lobbies.js';
import { useMainButton, haptic, tgUser } from '../../lib/telegram.js';
import { formatLada, ladaToNano, shortAddress } from '../../lib/format.js';
import { useTonSender } from '../../blockchain/tonConnect.js';
import { buildDeposit } from '../../blockchain/jetton.js';

const PLAYER_OPTIONS = [2, 3, 4, 5];

export default function PlayTab({ balance = null }) {
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [stake, setStake] = useState('10');
  const [minPlayers, setMinPlayers] = useState(2);
  const [sending, setSending] = useState(false);
  const address = useTonAddress();
  const { send } = useTonSender();
  const navigate = useNavigate();
  const username = tgUser()?.username || tgUser()?.first_name || null;

  const stakeNano = ladaToNano(stake || '0');
  const balanceOk = balance === null || stakeNano <= balance;
  const stakeValid = stakeNano > 0n && balanceOk;

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

      // Step 1: create lobby + race on backend (status='pending', player2=house_wallet)
      const result = await createLobby({
        stake: stakeNano.toString(),
        creator: address,
        username,
        minPlayers,
        maxPlayers: 5,
      });

      // result has { id, race: { on_chain_id, ... }, ... }
      const lobbyId = result.id;
      const onChainId = result.race?.on_chain_id;

      if (!onChainId) {
        console.error('[PlayTab] createLobby did not return race.on_chain_id:', result);
        alert('Lobby created but race setup failed. Please try again.');
        return;
      }

      // Step 2: host deposits their stake immediately (as part of lobby creation)
      // This triggers the indexer to open the lobby once confirmed on-chain.
      try {
        const tx = await buildDeposit({
          owner: address,
          amount: stakeNano.toString(),
          raceIdOnChain: onChainId,
        });
        await send(tx);
        haptic.success();
      } catch (e) {
        haptic.error();
        // Deposit failed (user rejected or wallet error).
        // Lobby exists but stays 'pending' — host can retry from Race screen.
        console.warn('[PlayTab] deposit failed:', e.message);
        // Still navigate so host can retry deposit from Race screen
      }

      setCreating(false);
      // Step 3: navigate to race screen (shows "waiting for opponent" until lobby opens)
      navigate(`/race/${lobbyId}`);
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
      if (result?.raceStarted && result?.race?.id) {
        navigate(`/race/${result.race.id}`);
      } else if (result?.raceStarted) {
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
    return <NoWalletView onDemo={() => navigate('/demo')} />;
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
              Lobby opens for others once your stake is deposited.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost" disabled={sending} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn" disabled={!stakeValid || sending} onClick={handleCreate}>
              {sending ? '…' : 'Create & deposit'}
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

// ── No-wallet landing view ────────────────────────────────────────────────────
// Shows when the user hasn't connected a wallet yet.
// Counts down 3 s then auto-navigates to the demo race.
function NoWalletView({ onDemo }) {
  const [secs, setSecs] = useState(30);

  // Auto-start after 30 seconds
  useEffect(() => {
    const timer = setTimeout(onDemo, 30000);
    return () => clearTimeout(timer);
  }, [onDemo]);

  // Decrement display counter every second
  useEffect(() => {
    if (secs <= 0) return;
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);

  return (
    <div className="empty" style={{ paddingTop: 32 }}>
      <p style={{ marginBottom: 20, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
        Connect your TON wallet to start racing.
      </p>

      <TonConnectButton />

      <div style={{
        margin: '22px 0 14px',
        color: 'var(--fg-muted)',
        fontSize: 13,
        letterSpacing: '0.04em',
      }}>
        — or —
      </div>

      <button
        className="btn"
        style={{ maxWidth: 220, marginBottom: 10 }}
        onClick={onDemo}
      >
        🏁 &nbsp;Watch Demo
      </button>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
        Demo starts in {secs}s…
      </p>
    </div>
  );
}
