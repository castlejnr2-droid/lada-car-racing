import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTonAddress } from '@tonconnect/ui-react';
import { fetchRace } from '../api/races.js';
import { cancelLobby } from '../api/lobbies.js';
import { useTonSender } from '../blockchain/tonConnect.js';
import { buildDeposit } from '../blockchain/jetton.js';
import { runReplay } from '../game/replay.js';
import { useBackButton, useMainButton, haptic } from '../lib/telegram.js';
import { formatLada } from '../lib/format.js';
import ResultScreen from './ResultScreen.jsx';

const POLL_MS = 3000;

export default function Race() {
  const { raceId } = useParams();
  const navigate = useNavigate();
  const address = useTonAddress();
  const { send } = useTonSender();
  const replayStopRef = useRef(null);
  const viewModeRef   = useRef('side');
  const [canvasEl, setCanvasEl] = useState(null);
  const canvasRef = useCallback((el) => setCanvasEl(el), []);

  const [race, setRace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [replayDone, setReplayDone] = useState(false);
  const [viewMode, setViewMode] = useState('side');

  useEffect(() => useBackButton(() => navigate('/')), [navigate]);

  // Poll backend until race is settled or refunded
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      while (!cancelled) {
        try {
          const r = await fetchRace(raceId);
          if (cancelled) return;
          setRace(r);
          if (r.state === 'settled' || r.state === 'active' || r.state === 'refunded') return;
        } catch (e) {
          console.warn('[race] poll error', e);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [raceId]);

  // Start replay once settled and canvas is ready
  useEffect(() => {
    if (race?.state !== 'settled' && race?.state !== 'active') return;
    if (!race.combined_seed || !canvasEl) return;
    const shortAddr = (a) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '???';
    replayStopRef.current = runReplay(canvasEl, race.combined_seed, {
      onComplete: () => {
        setReplayDone(true);
        haptic.success();
      },
      getViewMode: () => viewModeRef.current,
      playerNames: [
        race.player1_username || shortAddr(race.player1),
        race.player2_username || shortAddr(race.player2),
      ],
    });
    return () => replayStopRef.current?.();
  }, [race?.state, race?.combined_seed, canvasEl]);

  // Main button: deposit phase (only when player2 is known and it's our turn)
  useEffect(() => {
    if (!race || replayDone) return () => {};
    // While waiting for opponent, no deposit button
    if (race.waiting_for_player2) return () => {};

    const isP1 = race.player1 === address;
    const isP2 = race.player2 === address;
    if (!isP1 && !isP2) return () => {};

    const myDeposited = isP1 ? race.player1_deposited : race.player2_deposited;
    const stakeLada = formatLada(race.stake);

    if (race.state === 'awaiting_deposits' && !myDeposited) {
      return useMainButton(`Deposit ${stakeLada} LADA`, () => handleDeposit(), { enabled: !busy });
    }
    return useMainButton('Waiting…', () => {}, { enabled: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, address, busy, replayDone]);

  async function handleCancel() {
    if (!race?.lobby_id) return;
    setBusy(true);
    try {
      await cancelLobby(race.lobby_id, address);
      navigate('/');
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit() {
    if (!race?.on_chain_id) {
      alert('Race not yet registered on-chain. Try again in a few seconds.');
      return;
    }
    setBusy(true);
    try {
      haptic.medium();
      const tx = await buildDeposit({
        owner: address,
        amount: race.stake,
        raceIdOnChain: race.on_chain_id,
      });
      await send(tx);
      haptic.success();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleView() {
    haptic.tap();
    const next = viewModeRef.current === 'side' ? 'front' : 'side';
    viewModeRef.current = next;
    setViewMode(next);
  }

  // ─── Render ───
  if (!race) return <div className="empty">Loading race…</div>;

  if (replayDone || race.state === 'refunded') {
    return (
      <ResultScreen
        race={race}
        myAddress={address}
        refunded={race.state === 'refunded'}
        onDone={() => navigate('/')}
      />
    );
  }

  return (
    <div className="race">
      <div className="race__canvas-wrap">
        <canvas ref={canvasRef} className="race__canvas" width="100" height="100" />
        {race.state !== 'settled' && race.state !== 'active' && (
          <PhaseOverlay race={race} address={address} onCancel={handleCancel} cancelBusy={busy} />
        )}
        <button
          className="btn btn--ghost btn--small"
          onClick={toggleView}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, opacity: 0.85 }}
        >
          {viewMode === 'side' ? 'Front View' : 'Side View'}
        </button>
      </div>
    </div>
  );
}

function PhaseOverlay({ race, address, onCancel, cancelBusy }) {
  // Waiting for an opponent to join (host deposit not yet confirmed, or no player2 yet)
  if (race.waiting_for_player2) {
    const isCreator = race.player1 === address;
    return (
      <div className="race__overlay">
        <div className="race__phase-title">Waiting for opponent</div>
        <p className="race__phase-help">
          Your lobby will appear to others once your deposit is confirmed on-chain.
          Share the link or wait — someone will join!
        </p>
        <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          Stake {formatLada(race.stake)} LADA per player
        </p>
        {isCreator && (
          <button
            className="btn btn--danger btn--small"
            onClick={onCancel}
            disabled={cancelBusy}
            style={{ marginTop: 16 }}
          >
            {cancelBusy ? 'Cancelling…' : 'Cancel & Refund'}
          </button>
        )}
      </div>
    );
  }

  const isP1 = race.player1 === address;
  const myDeposited = isP1 ? race.player1_deposited : race.player2_deposited;

  return (
    <div className="race__overlay">
      <div className="race__phase-title">Deposit phase</div>
      <p className="race__phase-help">
        Deposit your LADA stake. Once both players deposit, the winner is
        determined and funds are released automatically.
      </p>
      {myDeposited ? (
        <p style={{ color: 'var(--accent-2)', marginBottom: 12 }}>
          ✓ Your deposit confirmed. Waiting for opponent…
        </p>
      ) : null}
      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        Stake {formatLada(race.stake)} LADA · pot {formatLada(race.pot)} LADA
      </p>
    </div>
  );
}
