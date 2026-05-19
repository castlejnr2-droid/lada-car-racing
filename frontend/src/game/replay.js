/**
 * Visual replay driver. Renders the race onto a canvas, ticked at ~60fps,
 * using the same seed the contract produced. Pure presentation — the
 * outcome is already decided on-chain.
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate } from './physics.js';

const LANE_COUNT = 2;

export function runReplay(canvas, hexSeed) {
  const ctx = canvas.getContext('2d');
  const rng = createRng(seedFromHex(hexSeed));
  const track = buildTrack(rng, LANE_COUNT);
  const { history } = simulate(track, rng);

  let frame = 0;
  function draw() {
    if (frame >= history.length) return;
    const positions = history[frame];
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // potholes
    ctx.fillStyle = '#0a0a0a';
    track.lanes.forEach((lane, i) => {
      const x = (i + 0.5) * (canvas.width / LANE_COUNT);
      lane.potholes.forEach((p) => {
        const y = (p / track.length) * canvas.height;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // cars
    positions.forEach((pos, i) => {
      const x = (i + 0.5) * (canvas.width / LANE_COUNT);
      const y = (pos / track.length) * canvas.height;
      ctx.fillStyle = i === 0 ? '#c8472b' : '#e8e2d0';
      ctx.fillRect(x - 10, y - 16, 20, 32);
    });

    frame++;
    requestAnimationFrame(draw);
  }
  draw();
}
