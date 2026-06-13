/**
 * SpectatorWatch — full-screen replay of a settled race for a spectator.
 *
 * Uses the identical runReplay path as Race.jsx and DemoRace.jsx.
 * No payoutLabel is passed (spectators are not participants; payout is private).
 * A SPECTATING badge distinguishes this from DEMO mode.
 * Handles invalid / non-settled race IDs with a friendly error screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchRace } from '../api/races.js';
import { runReplay } from '../game/replay.js';
import { useBackButton, haptic } from '../lib/telegram.js';
import { formatLada } from '../lib/format.js';
import { shareRace } from '../lib/share.js';

function shortAddr(a) {
  if (!a) return '???';
  return a.slice(0, 4) + '\u2026' + a.slice(-4);
}

export default function SpectatorWatch() {
  const { raceId }   = useParams();
  const navigate     = useNavigate();
  const stopRef      = useRef(null);

  const [canvasEl, setCanvasEl] = useState(null);
  const canvasRef = useCallback((el) => setCanvasEl(el), []);

  const [race, setRace]       = useState(null);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(false);
  const [shareMsg, setShareMsg] = useState(null);

  // Back button always returns to spectator list
  useEffect(() => useBackButton(() => navigate('/spectate')), [navigate]);

  // Fetch race, validate it is settled and has a seed
  useEffect(() => {
    if (!raceId) return;
    fetchRace(raceId)
      .then((data) => {
        if (data.state !== 'settled') {
          setError(
            data.state === 'refunded'
              ? 'This race was refunded and has no replay.'
              : 'This race has not finished yet. It cannot be watched until it is settled.',
          );
          return;
        }
        if (!data.combined_seed) {
          setError('Replay data is not available for this race.');
          return;
        }
        setRace(data);
      })
      .catch((e) => {
        setError(
          e.status === 404
            ? 'Race not found. The link may be invalid or expired.'
            : 'Could not load this race. Try again later.',
        );
      });
  }, [raceId]);

  // Start replay once both canvas element and race data are ready
  useEffect(() => {
    if (!canvasEl || !race) return;
    stopRef.current?.();

    const p1 = race.player1_username || shortAddr(race.player1);
    const p2 = race.player2_username || shortAddr(race.player2);

    try {
      stopRef.current = runReplay(canvasEl, race.combined_seed, {
        playerNames: [p1, p2],
        // No payoutLabel — spectators are not participants; payout details are private
        onComplete: () => {
          haptic.success();
          setDone(true);
        },
      });
    } catch (e) {
      console.error('[SpectatorWatch] runReplay failed:', e);
    }

    return () => { stopRef.current?.(); stopRef.current = null; };
  }, [canvasEl, race]);

  async function handleShare() {
    haptic.tap();
    const result = await shareRace(raceId);
    if (result === 'copied') {
      setShareMsg('Link copied');
      setTimeout(() => setShareMsg(null), 2000);
    }
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#1e2633', padding: 24,
      }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>⚠️</div>
        <div style={{
          color: 'var(--fg)', textAlign: 'center',
          fontSize: 15, maxWidth: 280, lineHeight: 1.5,
        }}>
          {error}
        </div>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => navigate('/spectate')}
          style={{ marginTop: 28 }}
        >
          Back to watch list
        </button>
      </div>
    );
  }

  // Derived display values (computed once race is available)
  const p1Name     = race ? (race.player1_username || shortAddr(race.player1)) : '';
  const p2Name     = race ? (race.player2_username || shortAddr(race.player2)) : '';
  const winnerName = race
    ? (race.winner === race.player1 ? p1Name : p2Name)
    : '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1e2633', overflow: 'hidden' }}>

      {/* Full-screen canvas — receives the runReplay WebGL output */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* SPECTATING badge — blue to distinguish from the red DEMO badge */}
      <div
        aria-label="Spectating mode"
        style={{
          position: 'absolute', top: 10, left: 10, zIndex: 20,
          background: 'rgba(30,80,200,0.88)',
          color: '#fff',
          fontFamily: 'monospace', fontWeight: 'bold',
          fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
          padding: '3px 9px',
          border: '1px solid rgba(255,255,255,0.18)',
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        SPECTATING
      </div>

      {/* Share button — visible once race data is loaded */}
      {race && (
        <button
          onClick={handleShare}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 20,
            background: 'rgba(30,80,200,0.88)',
            color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
            fontFamily: 'monospace', fontWeight: 'bold',
            fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 10px', cursor: 'pointer',
          }}
        >
          📤 Share
        </button>
      )}

      {/* "Link copied" toast */}
      {shareMsg && (
        <div style={{
          position: 'absolute', top: 40, right: 10, zIndex: 21,
          background: 'rgba(0,0,0,0.75)', color: '#fff',
          fontSize: 12, padding: '4px 10px',
          fontFamily: 'monospace', letterSpacing: '0.05em',
          pointerEvents: 'none',
        }}>
          {shareMsg}
        </div>
      )}

      {/* Loading state — race fetch in progress */}
      {!race && !error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10, color: 'var(--fg)', fontSize: 14,
          pointerEvents: 'none',
        }}>
          Loading race…
        </div>
      )}

      {/* Race over overlay — shown after replay completes */}
      {done && race && (
        <div
          className="race__overlay"
          style={{ background: 'rgba(10,15,24,0.92)' }}
        >
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>🏁</div>

          <div
            className="result__title is-win"
            style={{ marginBottom: 6, fontSize: 18 }}
          >
            {winnerName} wins!
          </div>

          <p style={{
            color: 'var(--fg-muted)', fontSize: 13,
            textAlign: 'center', maxWidth: 260,
            marginBottom: 6, lineHeight: 1.5,
          }}>
            {p1Name} vs {p2Name}
          </p>

          <p style={{ color: 'var(--fg-muted)', fontSize: 12, marginBottom: 28 }}>
            Stake: {formatLada(race.stake)} LADA per player
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn--ghost btn--small"
              onClick={handleShare}
            >
              📤 Share
            </button>
            <button
              className="btn btn--ghost btn--small"
              onClick={() => navigate('/spectate')}
            >
              Back to watch list
            </button>
          </div>

          {shareMsg && (
            <div style={{
              marginTop: 10, fontSize: 12,
              color: 'var(--fg-muted)', letterSpacing: '0.05em',
            }}>
              {shareMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
