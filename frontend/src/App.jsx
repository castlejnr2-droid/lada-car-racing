import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import Home from './components/Home.jsx';
import Race from './components/Race.jsx';
import DemoRace from './components/DemoRace.jsx';

export default function App() {
  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    // Apply Telegram theme to the document so safe-areas + colors line up
    document.body.style.setProperty(
      '--tg-bg',
      WebApp.themeParams.bg_color || 'var(--bg)',
    );
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/race/:raceId" element={<Race />} />
        <Route path="/demo" element={<DemoRace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
