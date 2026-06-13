/**
 * WatchTab — list of recently settled races for spectating.
 * Auto-refreshes every 5 seconds so new finishes appear at the top.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSettledRaces } from '../../api/races.js';
import { formatLada } from '../../lib/format.js';
import { haptic } from '../../lib/telegram.js';
import { shareRace } from '../../lib/share.js';

function shortAddr(a) {
  if (!a) return '???';
  return a.slice(0, 4) + '\u2026' + a.slice(-4);
}

function displayName(username, address) {
  return username || shortAddr(address);
}

export default function WatchTab() {
  const navigate = useNavigate();
  const [races, setRaces]   = useState(null);  // null = loading
  const [error, setError]   = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchSettledRaces(20);
        if (!cancelled) { setRaces(data); setError(null); }
      } catch (e) {
        console.warn('[spectator] fetch failed', e);
        if (!cancelled && races === null) setError('Could not load races. Try again later.');
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // races intentionally omitted — stale-closure check only for initial error
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error)         return <div className="empty">{error}</div>;
  if (races === null) return <div className="empty">Loading…</div>;
  if (races.length === 0) {
    return <div className="empty">No finished races yet. Check back soon!</div>;
  }

  return (
    <div style={{ paddingTop: 4 }}>
      {races.map((r) => {
        const p1 = displayName(r.player1_username, r.player1);
        const p2 = displayName(r.player2_username, r.player2);
        const winnerName = r.winner === r.player1 ? p1
          : r.winner === r.player2 ? p2
          : null;

        return (
          <div
            key={r.id}
            className="card"
            style={{ cursor: 'pointer', marginBottom: 8 }}
            onClick={() => { haptic.tap(); navigate(`/spectate/${r.id}`); }}
          >
            <div className="card__row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="card__title"
                  style={{
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', fontSize: 13,
                  }}
                >
                  {p1} vs {p2}
                </div>
                <div className="card__meta" style={{ marginTop: 3 }}>
                  {formatLada(r.stake)} LADA each
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                {winnerName && (
                  <div style={{ fontSize: 12, color: 'var(--accent-2)', fontWeight: 'bold' }}>
                    🏆 {winnerName}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                  ▶ Watch
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    haptic.tap();
                    shareRace(r.id).then((result) => {
                      if (result === 'copied') {
                        setCopiedId(r.id);
                        setTimeout(() => setCopiedId((cur) => cur === r.id ? null : cur), 2000);
                      }
                    });
                  }}
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'block',
                    width: '100%',
                    textAlign: 'right',
                  }}
                >
                  {copiedId === r.id ? 'Link copied' : '📤 Share'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
