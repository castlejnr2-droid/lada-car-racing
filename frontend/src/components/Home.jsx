import { useEffect, useState } from 'react';
import { useTonAddress } from '@tonconnect/ui-react';
import { tg, haptic, tgUser } from '../lib/telegram.js';
import { upsertPlayer } from '../api/players.js';
import PlayTab from './tabs/PlayTab.jsx';
import StatsTab from './tabs/StatsTab.jsx';
import LeaderboardTab from './tabs/LeaderboardTab.jsx';

const TABS = [
  { id: 'play',        label: 'Play',        icon: '🚗' },
  { id: 'stats',       label: 'Stats',       icon: '📊' },
  { id: 'leaderboard', label: 'Leaders',     icon: '🏆' },
];

export default function Home() {
  const [tab, setTab] = useState('play');
  const address = useTonAddress();

  // Once a wallet is connected, upsert the player in the backend so the
  // Telegram → wallet link exists by the time the user hits /stats.
  useEffect(() => {
    if (!address) return;
    const user = tgUser();
    upsertPlayer({
      address,
      telegramId: user?.id,
      username:   user?.username || user?.first_name,
    }).catch((e) => console.warn('[players] upsert failed', e));
  }, [address]);

  useEffect(() => {
    // Home screen has no BackButton (this is the root)
    tg.BackButton.hide();
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <span><span className="logo">LADA</span> <span className="star">★</span> RACING</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {address ? address.slice(0, 4) + '…' + address.slice(-4) : 'not connected'}
        </span>
      </header>

      <main className="app__body">
        {tab === 'play'        && <PlayTab />}
        {tab === 'stats'       && <StatsTab />}
        {tab === 'leaderboard' && <LeaderboardTab />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tabbar__btn ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => { haptic.select(); setTab(t.id); }}
          >
            <span className="icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
