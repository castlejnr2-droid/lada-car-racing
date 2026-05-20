import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../../api/leaderboard.js';
import { formatLada, shortAddress } from '../../lib/format.js';
import { haptic } from '../../lib/telegram.js';

const PERIODS = [
  { id: 'day',   label: 'Today' },
  { id: 'week',  label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all',   label: 'All' },
];

export default function LeaderboardTab() {
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchLeaderboard(period)
      .then((res) => setRows(res.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            className={`btn btn--small ${period === p.id ? '' : 'btn--ghost'}`}
            onClick={() => { haptic.select(); setPeriod(p.id); }}
            style={{ flex: 1 }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="empty">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="empty">No settled races yet. Be the first to floor it.</p>
      )}

      {rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        return (
          <div key={r.address} className="card">
            <div className="card__row">
              <div>
                <div className="card__title">
                  <span style={{ marginRight: 8, color: 'var(--accent-2)' }}>{medal}</span>
                  {r.username || shortAddress(r.address)}
                </div>
                <div className="card__meta">{r.wins} wins · {r.losses} losses</div>
              </div>
              <div style={{ color: 'var(--accent-2)', fontWeight: 'bold' }}>
                {formatLada(r.totalWon)} LADA
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
