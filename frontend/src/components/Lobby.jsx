import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchLobbies, createLobby, joinLobby } from '../api/lobbies.js';

export default function Lobby() {
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchLobbies()
      .then(setLobbies)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const lobby = await createLobby({ stake: 10 });
    navigate(`/race/${lobby.id}`);
  }

  async function handleJoin(id) {
    await joinLobby(id);
    navigate(`/race/${id}`);
  }

  if (loading) return <div>Loading lobbies…</div>;

  return (
    <div className="lobby">
      <h1>Lada Car Racing</h1>
      <button onClick={handleCreate}>Create lobby</button>
      <ul>
        {lobbies.map((l) => (
          <li key={l.id}>
            Stake: {l.stake} LADA — {l.players}/{l.maxPlayers}
            <button onClick={() => handleJoin(l.id)}>Join</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
