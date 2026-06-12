/**
 * Pure race physics. Given an RNG, produces:
 *   - per-lane pothole positions along the track
 *   - per-tick speed for each car (slowed when hitting a pothole)
 *
 * Pure file: no DOM, no blockchain, no I/O.
 */

export const TRACK_LENGTH      = 1200;
export const POTHOLES_PER_LANE = 14;
const BASE_SPEED               = 3;
const POTHOLE_PENALTY          = 0.35;
const POTHOLE_HIT_RADIUS       = 5;
const MAX_TICKS                = 600;

export function buildTrack(rng, laneCount) {
  const lanes = [];
  for (let l = 0; l < laneCount; l++) {
    const potholes = [];
    for (let i = 0; i < POTHOLES_PER_LANE; i++) {
      // never put a pothole in the first ~80 units (give cars a clean start)
      potholes.push(80 + Math.floor(rng() * (TRACK_LENGTH - 80)));
    }
    lanes.push({ potholes: potholes.sort((a, b) => a - b) });
  }
  return { length: TRACK_LENGTH, lanes };
}

export function simulate(track, rng) {
  const positions = track.lanes.map(() => 0);
  const speeds    = track.lanes.map(() => 0);
  const hitFlags  = track.lanes.map(() => false);
  const history   = [];
  let tick = 0;

  while (positions.some((p) => p < track.length) && tick < MAX_TICKS) {
    track.lanes.forEach((lane, i) => {
      if (positions[i] >= track.length) {
        speeds[i] = 0;
        hitFlags[i] = false;
        return;
      }
      const onPothole = lane.potholes.some(
        (p) => Math.abs(p - positions[i]) < POTHOLE_HIT_RADIUS,
      );
      const jitter = 0.85 + rng() * 0.3;
      const speed = BASE_SPEED * (onPothole ? POTHOLE_PENALTY : 1) * jitter;
      positions[i] += speed;
      speeds[i] = speed;
      hitFlags[i] = onPothole;
    });
    history.push({
      positions: [...positions],
      speeds:    [...speeds],
      hits:      [...hitFlags],
    });
    tick++;
  }

  // Whoever crossed the finish line first wins. If both crossed in the same
  // tick (very rare), the higher position wins.
  let winnerIdx = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] > positions[winnerIdx]) winnerIdx = i;
  }
  return { history, winner: winnerIdx };
}
