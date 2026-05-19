import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../api/leaderboard.js';

export default function Leaderboard() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetchLeaderboard().then(setRows);
  }, []);

  return (
    <div className="leaderboard">
      <h2>Top racers</h2>
      <ol>
        {rows.map((r) => (
          <li key={r.address}>
            {r.username || r.address.slice(0, 6)} — {r.wins} wins ({r.totalWon} LADA)
          </li>
        ))}
      </ol>
    </div>
  );
}
