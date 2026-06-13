import { useEffect, useRef, useState } from 'react';
import { useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { tg, haptic, tgUser } from '../lib/telegram.js';
import { upsertPlayer } from '../api/players.js';
import { getLadaBalance } from '../blockchain/jetton.js';
import PlayTab from './tabs/PlayTab.jsx';
import StatsTab from './tabs/StatsTab.jsx';
import LeaderboardTab from './tabs/LeaderboardTab.jsx';
import WatchTab from './tabs/WatchTab.jsx';

const TABS = [
  { id: 'play',        label: 'Play',    icon: '🚗' },
  { id: 'stats',       label: 'Stats',   icon: '📊' },
  { id: 'leaderboard', label: 'Leaders', icon: '🏆' },
  { id: 'watch',       label: 'Watch',   icon: '👁' },
];

export default function Home({ initialTab = 'play' }) {
  const [tab, setTab] = useState(initialTab);
  const [balance, setBalance] = useState(null);
  const address = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();

  // ── Background 3D scene refs ─────────────────────────────────────────────
  const menuCanvasRef = useRef(null);
  const menuSceneRef  = useRef(null);
  // tabRef lets the async import callback read the current tab without stale closure
  const tabRef        = useRef(tab);
  tabRef.current      = tab;

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
    if (!address) { setBalance(null); return; }
    let cancelled = false;
    async function fetch() {
      const bal = await getLadaBalance(address);
      if (!cancelled) setBalance(bal);
    }
    fetch();
    const t = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [address]);

  useEffect(() => {
    tg.BackButton.hide();
  }, []);

  // Start the ambient background scene once on mount; destroy on unmount.
  // Dynamic import keeps menuScene.js out of the critical-path bundle.
  useEffect(() => {
    let scene = null;
    import('../game/menuScene.js')
      .then(({ startMenuScene }) => {
        if (!menuCanvasRef.current) return;  // component unmounted before load finished
        try {
          scene = startMenuScene(menuCanvasRef.current);
          menuSceneRef.current = scene;
          // Apply current tab state — may have changed while the import was in-flight
          if (tabRef.current !== 'play') scene.pause();
        } catch (e) {
          console.warn('[Home] menuScene init error:', e);
        }
      })
      .catch((e) => console.warn('[Home] menuScene import failed:', e));
    return () => {
      scene?.destroy();
      menuSceneRef.current = null;
    };
  }, []); // mount/unmount only

  // Pause rendering when switching away from the play tab; resume on return.
  useEffect(() => {
    const s = menuSceneRef.current;
    if (!s) return;
    if (tab === 'play') s.resume();
    else s.pause();
  }, [tab]);

  return (
    <div className="app">
      {/* Background 3D scene — rendered behind overlay and all UI content.
          Falls back to the static jpg in global.css if WebGL is unavailable. */}
      <canvas ref={menuCanvasRef} className="app__bg-canvas" />

      <header className="app__header">
        <span><span className="logo">LADA</span> <span className="star">★</span> RACING</span>
        <div style={{ textAlign: 'right', lineHeight: 1.35 }}>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {address ? address.slice(0, 4) + '…' + address.slice(-4) : 'not connected'}
          </div>
          {address && balance !== null && (
            <div style={{ fontSize: 11, color: 'var(--accent-2)', fontWeight: 'bold' }}>
              💰 {Number(balance / 1_000_000_000n).toLocaleString()} LADA
            </div>
          )}
          {address && (
            <button
              onClick={() => { haptic.select(); tonConnectUI.disconnect(); }}
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                marginTop: 2,
                padding: 0,
                opacity: 0.7,
              }}
            >
              disconnect
            </button>
          )}
        </div>
      </header>

      <main className="app__body">
        {tab === 'play'        && <PlayTab balance={balance} />}
        {tab === 'stats'       && <StatsTab />}
        {tab === 'leaderboard' && <LeaderboardTab />}
        {tab === 'watch'       && <WatchTab />}
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
