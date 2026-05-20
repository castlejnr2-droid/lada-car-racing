import { useEffect, useState } from 'react';
import { useTonAddress } from '@tonconnect/ui-react';
import { fetchPlayerByTelegram } from '../../api/players.js';
import { tgUser } from '../../lib/telegram.js';
import { formatLada, shortAddress } from '../../lib/format.js';

export default function StatsTab() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const address = useTonAddress();

  useEffect(() => {
    const user = tgUser();
    if (!user?.id) {
      setLoading(false);
      setError('Stats need Telegram. Open this app from inside the bot.');
      return;
    }
    fetchPlayerByTelegram(user.id)
      .then(setProfile)
      .catch((e) => { setError(e.status === 404 ? null : e.message); setProfile(null); })
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) return <p className="empty">Loading…</p>;
  if (error)   return <p className="empty">{error}</p>;

  if (!profile) {
    return (
      <p className="empty">
        No races on the books yet. Open the Play tab and pick an opponent.
      </p>
    );
  }

  const s = profile.stats || {};
  const winrate = s.races_played > 0
    ? Math.round((s.wins / s.races_played) * 100) + '%'
    : '—';

  return (
    <div>
      <div className="card">
        <div className="card__title">Wallet</div>
        <div className="card__meta">{shortAddress(profile.address)}</div>
      </div>

      <div className="stats-grid">
        <Cell label="Races"     value={s.races_played ?? 0} />
        <Cell label="Wins"      value={s.wins ?? 0} />
        <Cell label="Losses"    value={s.losses ?? 0} />
        <Cell label="Win rate"  value={winrate} />
        <Cell label="Won"   value={formatLada(s.total_won) + ' LADA'} wide />
        <Cell label="Lost"  value={formatLada(s.total_lost) + ' LADA'} wide />
      </div>
    </div>
  );
}

function Cell({ label, value, wide }) {
  return (
    <div className="cell" style={wide ? { gridColumn: 'span 2' } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
