import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import Home from './components/Home.jsx';
import Race from './components/Race.jsx';
import DemoRace from './components/DemoRace.jsx';
import SpectatorWatch from './components/SpectatorWatch.jsx';

/**
 * Handles Telegram Mini App start parameters for deep-linking.
 * Must live inside BrowserRouter so it can call useNavigate.
 * Supported formats:
 *   r_<raceId>  →  /spectate/<raceId>
 */
function StartParamRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const sp = WebApp.initDataUnsafe?.start_param;
    if (sp?.startsWith('r_')) {
      navigate(`/spectate/${encodeURIComponent(sp.slice(2))}`, { replace: true });
    }
  }, [navigate]);
  return null;
}

export default function App() {
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    document.body.style.setProperty(
      '--tg-bg',
      WebApp.themeParams.bg_color || 'var(--bg)',
    );
  }, []);

  return (
    <BrowserRouter>
      <StartParamRedirect />
      <Routes>
        <Route path="/"                   element={<Home />} />
        <Route path="/race/:raceId"       element={<Race />} />
        <Route path="/demo"               element={<DemoRace />} />
        <Route path="/spectate"           element={<Home initialTab="watch" />} />
        <Route path="/spectate/:raceId"   element={<SpectatorWatch />} />
        <Route path="*"                   element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
