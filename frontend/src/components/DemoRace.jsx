/**
 * DemoRace — fully local, no-backend race for unconnected visitors.
 *
 * Generates a random seed each iteration, runs the full 3D replay, then
 * shows a winner screen with a "Play for Real" wallet-connect prompt.
 * After a brief pause it loops automatically with a new seed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { runReplay } from '../game/replay.js';
import { haptic } from '../lib/telegram.js';

// ── Config ────────────────────────────────────────────────────────────────────
const PLAYER_NAMES   = ['Player 1', 'Player 2'];
const RESULT_HOLD_MS = 5_000;   // show winner screen before auto-looping

function randomSeed() {
  // 32-char hex: same format the backend would supply
  return Array.from({ length: 8 }, () =>
    (Math.random() * 0x100000000 >>> 0).toString(16).padStart(8, '0'),
  ).join('');
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DemoRace() {
  const navigate    = useNavigate();
  const address     = useTonAddress();
  const [tcUI]      = useTonConnectUI();

  const canvasRef  = useRef(null);
  const stopRef    = useRef(null);
  const timerRef   = useRef(null);
  const simRef     = useRef(null);
  const loopRef    = useRef(0);   // iteration counter (for badge)

  const [raceDone, setRaceDone]   = useState(false);
  const [winnerIdx, setWinnerIdx] = useState(0);
  const [loopCount, setLoopCount] = useState(0);

  // If the user connects a wallet while watching, send them home to play.
  useEffect(() => {
    if (address) navigate('/');
  }, [address, navigate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRef.current?.();
      clearTimeout(timerRef.current);
    };
  }, []);

  function startRace() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Tear down any running race first
    stopRef.current?.();
    clearTimeout(timerRef.current);
    setRaceDone(false);
    simRef.current = null;

    const seed = randomSeed();
    try {
      stopRef.current = runReplay(canvas, seed, {
        playerNames: PLAYER_NAMES,
        onTick: (_tick, sim) => { simRef.current = sim; },
        onComplete: () => {
          const w = simRef.current?.winner ?? 0;
          setWinnerIdx(w);
          setRaceDone(true);
          haptic.success();
          // Auto-loop after hold period
          timerRef.current = setTimeout(() => {
            loopRef.current += 1;
            setLoopCount(loopRef.current);
            startRace();
          }, RESULT_HOLD_MS);
        },
      });
    } catch (e) {
      console.error('[DemoRace] runReplay failed:', e);
    }
  }

  // Canvas ref callback — delays one animation frame so flex layout is computed
  const onCanvasReady = useCallback((el) => {
    canvasRef.current = el;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => startRace());
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1e2633', overflow: 'hidden' }}>
      <canvas
        ref={onCanvasReady}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* DEMO badge */}
      <DemoBadge loopCount={loopCount} />

      {/* Back arrow */}
      <button
        className="btn btn--ghost btn--small"
        onClick={() => { haptic.tap(); navigate('/'); }}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, opacity: 0.85 }}
      >
        ← Back
      </button>

      {/* Winner overlay */}
      {raceDone && (
        <WinnerOverlay
          winnerName={PLAYER_NAMES[winnerIdx]}
          onPlayReal={() => tcUI.openModal()}
          onBack={() => navigate('/')}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DemoBadge({ loopCount }) {
  return (
    <div
      aria-label="Demo race"
      style={{
        position:  'absolute',
        top: 10, left: 10,
        zIndex: 20,
        background: 'rgba(200,71,43,0.88)',
        color: '#fff',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        padding: '3px 9px',
        border: '1px solid rgba(255,255,255,0.18)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      DEMO{loopCount > 0 ? ` #${loopCount + 1}` : ''}
    </div>
  );
}

function WinnerOverlay({ winnerName, onPlayReal, onBack }) {
  return (
    <div
      className="race__overlay"
      style={{ background: 'rgba(10,15,24,0.90)' }}
    >
      <div style={{ fontSize: 54, lineHeight: 1, marginBottom: 10 }}>🏆</div>

      <div
        className="result__title is-win"
        style={{ marginBottom: 6, fontSize: 20 }}
      >
        {winnerName} wins!
      </div>

      <p style={{
        color: 'var(--fg-muted)',
        fontSize: 13,
        textAlign: 'center',
        maxWidth: 260,
        marginBottom: 28,
        lineHeight: 1.5,
      }}>
        This was a demo race.
        <br />
        Connect your wallet to race for real LADA.
      </p>

      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 10,
        width: '100%', maxWidth: 260,
      }}>
        {/* Primary CTA */}
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={onPlayReal}
        >
          🚗 &nbsp;Play for Real
        </button>

        {/* TonConnect button as a secondary wallet option */}
        <div style={{ opacity: 0.9 }}>
          <TonConnectButton />
        </div>

        <button
          className="btn btn--ghost btn--small"
          onClick={onBack}
          style={{ marginTop: 4, opacity: 0.7 }}
        >
          Back to lobby
        </button>
      </div>

      {/* Auto-loop hint */}
      <p style={{
        position: 'absolute', bottom: 18,
        color: 'var(--fg-muted)', fontSize: 11,
        letterSpacing: '0.04em',
      }}>
        New race starting automatically…
      </p>
    </div>
  );
}
