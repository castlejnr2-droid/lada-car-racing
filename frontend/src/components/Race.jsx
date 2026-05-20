import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTonAddress } from '@tonconnect/ui-react';
import { fetchRace } from '../api/races.js';
import { useTonSender } from '../blockchain/tonConnect.js';
import { buildCommit, buildReveal, buildTimeoutRefund } from '../blockchain/escrowContract.js';
import { buildDeposit } from '../blockchain/jetton.js';
import { generateSecret, commitOf, saveSecret, loadSecret, clearSecret } from '../game/secret.js';
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
  const canvasRef = useRef(null);
  const replayStopRef = useRef(null);

  const [race, setRace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [replayDone, setReplayDone] = useState(false);

  useEffect(() => useBackButton(() => navigate('/')), [navigate]);

  // Poll the backend for race state until settled / refunded
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      while (!cancelled) {
        try {
          const r = await fetchRace(raceId);
          if (cancelled) return;
          setRace(r);
          if (r.state === 'settled' || r.state === 'refunded') return;
        } catch (e) {
          console.warn('[race] poll error', e);
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [raceId]);

  // Once race is settled and we have a combined_seed, run the replay
  useEffect(() => {
    if (race?.state !== 'settled' || !race.combined_seed || !canvasRef.current) return;
    replayStopRef.current = runReplay(canvasRef.current, race.combined_seed, {
      onComplete: () => {
        setReplayDone(true);
        haptic.success();
        clearSecret(raceId);
      },
    });
    return () => replayStopRef.current?.();
  }, [race?.state, race?.combined_seed, raceId]);

  // Pick the current MainButton based on race phase + whether we acted yet
  useEffect(() => {
    if (!race || replayDone) return () => {};
    const me = address;
    const isP1 = race.player1 === me;
    const isP2 = race.player2 === me;
    if (!isP1 && !isP2) return () => {};

    const myDeposited = isP1 ? race.player1_deposited : race.player2_deposited;
    const myCommitted = isP1 ? race.player1_committed : race.player2_committed;
    const myRevealed  = isP1 ? race.player1_revealed  : race.player2_revealed;
    const stakeLada = formatLada(race.stake);

    if (race.state === 'awaiting_deposits' && !myDeposited) {
      return useMainButton(`Deposit ${stakeLada} LADA`, () => handleDeposit(), { enabled: !busy });
    }
    if (race.state === 'awaiting_commits' && !myCommitted) {
      return useMainButton('Commit secret', () => handleCommit(), { enabled: !busy });
    }
    if (race.state === 'awaiting_reveals' && !myRevealed) {
      return useMainButton('Reveal secret', () => handleReveal(), { enabled: !busy });
    }
    // Default: waiting for opponent or chain confirmation
    return useMainButton('Waiting…', () => {}, { enabled: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, address, busy, replayDone]);

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

  async function handleCommit() {
    setBusy(true);
    try {
      haptic.medium();
      const secret = generateSecret();
      const commit = await commitOf(secret);
      saveSecret(raceId, secret);                // persist BEFORE sending tx
      const tx = buildCommit(race.on_chain_id, commit);
      await send(tx);
      haptic.success();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    setBusy(true);
    try {
      const secret = loadSecret(raceId);
      if (!secret) throw new Error('No saved secret for this race. Did you commit on this device?');
      haptic.medium();
      const tx = buildReveal(race.on_chain_id, secret);
      await send(tx);
      haptic.success();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTimeoutRefund() {
    setBusy(true);
    try {
      const tx = buildTimeoutRefund(race.on_chain_id);
      await send(tx);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
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
        <canvas ref={canvasRef} className="race__canvas" />
        {race.state !== 'settled' && <PhaseOverlay race={race} address={address} onRefund={handleTimeoutRefund} />}
      </div>
    </div>
  );
}

function PhaseOverlay({ race, address, onRefund }) {
  const phaseTitles = {
    awaiting_deposits: 'Deposit phase',
    awaiting_commits:  'Commit phase',
    awaiting_reveals:  'Reveal phase',
  };
  const phaseHelp = {
    awaiting_deposits: 'Both players need to deposit their Lada stake into the escrow contract.',
    awaiting_commits:  'Each player picks a secret and submits its hash. Winner is locked once both commits land.',
    awaiting_reveals:  'Reveal your secret so the contract can derive the winner.',
  };
  const me = address;
  const isP1 = race.player1 === me;
  const myActed =
    race.state === 'awaiting_deposits' ? (isP1 ? race.player1_deposited : race.player2_deposited) :
    race.state === 'awaiting_commits'  ? (isP1 ? race.player1_committed : race.player2_committed) :
    race.state === 'awaiting_reveals'  ? (isP1 ? race.player1_revealed  : race.player2_revealed)  : false;

  return (
    <div className="race__overlay">
      <div className="race__phase-title">{phaseTitles[race.state]}</div>
      <p className="race__phase-help">{phaseHelp[race.state]}</p>
      {myActed && (
        <p style={{ color: 'var(--accent-2)', marginBottom: 12 }}>
          ✓ You're in. Waiting for your opponent…
        </p>
      )}
      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        Stake {formatLada(race.stake)} LADA · pot {formatLada(race.pot)} LADA
      </p>
      {race.reveal_deadline && new Date(race.reveal_deadline) < new Date() && (
        <button className="btn btn--ghost" style={{ marginTop: 16 }} onClick={onRefund}>
          Trigger refund (deadline passed)
        </button>
      )}
    </div>
  );
}
