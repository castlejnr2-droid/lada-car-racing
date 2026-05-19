import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { commitSecret, revealSecret, subscribeToWinner } from '../blockchain/escrowContract.js';
import { runReplay } from '../game/replay.js';

/**
 * Race screen. Lifecycle:
 *   1. commit phase — player submits hash(secret)
 *   2. reveal phase — player reveals secret
 *   3. contract emits winner + combined seed
 *   4. game/replay.js animates the race from the seed (purely visual)
 */
export default function Race() {
  const { raceId } = useParams();
  const [phase, setPhase] = useState('commit');
  const [seed, setSeed] = useState(null);

  useEffect(() => {
    const unsub = subscribeToWinner(raceId, ({ winner, combinedSeed }) => {
      setSeed(combinedSeed);
      setPhase('replay');
    });
    return unsub;
  }, [raceId]);

  useEffect(() => {
    if (phase !== 'replay' || !seed) return;
    const canvas = document.getElementById('race-canvas');
    runReplay(canvas, seed);
  }, [phase, seed]);

  async function handleCommit() {
    await commitSecret(raceId);
    setPhase('reveal');
  }

  async function handleReveal() {
    await revealSecret(raceId);
    setPhase('waiting');
  }

  return (
    <div className="race">
      <h2>Race #{raceId}</h2>
      {phase === 'commit'  && <button onClick={handleCommit}>Commit secret</button>}
      {phase === 'reveal'  && <button onClick={handleReveal}>Reveal secret</button>}
      {phase === 'waiting' && <p>Waiting for opponent…</p>}
      {phase === 'replay'  && <canvas id="race-canvas" width="360" height="640" />}
    </div>
  );
}
