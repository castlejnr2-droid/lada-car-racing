import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import Lobby from './components/Lobby.jsx';
import Race from './components/Race.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import Wallet from './components/Wallet.jsx';

export default function App() {
  useEffect(() => {
    // Tell Telegram the Mini App is ready
    WebApp.ready();
    WebApp.expand();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/race/:raceId" element={<Race />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/wallet" element={<Wallet />} />
      </Routes>
    </BrowserRouter>
  );
}
