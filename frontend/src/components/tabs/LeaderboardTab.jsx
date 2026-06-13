import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../../api/leaderboard.js';
import { formatLada, shortAddress } from '../../lib/format.js';
import { haptic } from '../../lib/telegram.js';

const NANO = 1_000_000_000n;

/**
 * Format a net profit value (numeric string from backend, may be negative).
 * Returns { text, color } for display.
 */
function formatNetProfit(amount) {
  if (amount == null || amount === '') {
    return { text: '0.00 LADA', color: 'var(--fg-muted)' };
  }
  const n = BigInt(amount);
  if (n === 0n) return { text: '0.00 LADA', color: 'var(--fg-muted)' };

  const isNeg = n < 0n;
  const abs   = isNeg ? -n : n;

  // Format absolute value (same logic as formatLada with 2 decimals)
  const whole   = abs / NANO;
  const frac    = abs % NANO;
  const fracStr = frac.toString().padStart(9, '0').slice(0, 2);
  const text    = (isNeg ? '-' : '+') + whole + '.' + fracStr + ' LADA';
  const color   = isNeg ? '#ff5555' : '#44cc88';
  return { text, color };
}

const VIEWS = [
  { id: 'wins',   label: 'Most Wins' },
  { id: 'profit', label: 'Net Profit' },
];

export default function LeaderboardTab() {
  const [sort, setSort]     = useState('wins');
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchLeaderboard(sort)
      .then((res) => setRows(res.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [sort]);

  return (
    <div>
      {/* Sort toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`btn btn--small ${sort === v.id ? '' : 'btn--ghost'}`}
            onClick={() => { haptic.select(); setSort(v.id); }}
            style={{ flex: 1 }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading && <p className="empty">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="empty">No settled races yet. Be the first to floor it.</p>
      )}

      {!loading && rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const { text: profitText, color: profitColor } = formatNetProfit(r.netProfit);
        const name = r.username || shortAddress(r.address);

        return (
          <div key={r.address} className="card" style={{ marginBottom: 6 }}>
            <div className="card__row">
              <div style={{ flex: 1, minWidth: 0 }}>

                <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--accent-2)', minWidth: 22 }}>{medal}</span>
                  {r.avatarUrl && (
                    <img
                      src={r.avatarUrl}
                      alt=""
                      style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }}
                    />
                  )}
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {name}
                  </span>
                </div>

                <div className="card__meta" style={{ marginTop: 3 }}>
                  {r.wins}W / {r.losses}L
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                {sort === 'wins' ? (
                  <>
                    <div style={{ fontWeight: 'bold', color: 'var(--accent-2)', fontSize: 14 }}>
                      {r.wins} {r.wins === 1 ? 'win' : 'wins'}
                    </div>
                    <div style={{ fontSize: 11, color: profitColor, marginTop: 2 }}>
                      {profitText}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 'bold', color: profitColor, fontSize: 14 }}>
                      {profitText}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                      {r.wins} {r.wins === 1 ? 'win' : 'wins'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
