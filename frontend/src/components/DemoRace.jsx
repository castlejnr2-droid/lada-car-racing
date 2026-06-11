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

  const [canvasEl, setCanvasEl]   = useState(null);
  const canvasRef = useCallback((el) => setCanvasEl(el), []);

  const [seed, setSeed]           = useState(randomSeed);
  const [raceDone, setRaceDone]   = useState(false);
  const [winnerIdx, setWinnerIdx] = useState(0);
  const [loopCount, setLoopCount] = useState(0);

  const stopRef  = useRef(null);
  const simRef   = useRef(null);
  const timerRef = useRef(null);

  // If the user connects a wallet while watching, send them home to play.
  useEffect(() => {
    if (address) navigate('/');
  }, [address, navigate]);

  // (Re-)start the replay whenever the seed changes (each loop iteration).
  useEffect(() => {
    if (!canvasEl) return;

    // Tear down any running race
    stopRef.current?.();
    clearTimeout(timerRef.current);
    setRaceDone(false);
    simRef.current = null;

    stopRef.current = runReplay(canvasEl, seed, {
      playerNames: PLAYER_NAMES,
      onTick: (_tick, sim) => { simRef.current = sim; },
      onComplete: () => {
        const w = simRef.current?.winner ?? 0;
        setWinnerIdx(w);
        setRaceDone(true);
        haptic.success();
        // Auto-loop
        timerRef.current = setTimeout(() => {
          setSeed(randomSeed());
          setLoopCount((n) => n + 1);
        }, RESULT_HOLD_MS);
      },
    });

    return () => {
      stopRef.current?.();
      clearTimeout(timerRef.current);
    };
  }, [canvasEl, seed]); // loopCount intentionally omitted — seed change drives re-run

  return (
    <div className="race">
      <div className="race__canvas-wrap">
        <canvas ref={canvasRef} className="race__canvas" width="100" height="100" />

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
