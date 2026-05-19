/**
 * Pure race physics. Given an RNG, produces:
 *   - a pothole layout for each lane
 *   - per-tick speed for each car (slowed when hitting a pothole)
 *
 * Pure file: no DOM, no blockchain, no I/O. Easy to unit test.
 */

const TRACK_LENGTH = 1000;
const POTHOLES_PER_LANE = 12;
const BASE_SPEED = 6;
const POTHOLE_PENALTY = 0.4;

export function buildTrack(rng, laneCount) {
  const lanes = [];
  for (let l = 0; l < laneCount; l++) {
    const potholes = [];
    for (let i = 0; i < POTHOLES_PER_LANE; i++) {
      potholes.push(Math.floor(rng() * TRACK_LENGTH));
    }
    lanes.push({ potholes: potholes.sort((a, b) => a - b) });
  }
  return { length: TRACK_LENGTH, lanes };
}

export function simulate(track, rng) {
  const positions = track.lanes.map(() => 0);
  const history = [];
  let tick = 0;
  while (positions.some((p) => p < track.length) && tick < 2000) {
    track.lanes.forEach((lane, i) => {
      if (positions[i] >= track.length) return;
      const onPothole = lane.potholes.some(
        (p) => Math.abs(p - positions[i]) < 4,
      );
      const speed = BASE_SPEED * (onPothole ? POTHOLE_PENALTY : 1) * (0.85 + rng() * 0.3);
      positions[i] += speed;
    });
    history.push([...positions]);
    tick++;
  }
  const winner = positions.indexOf(Math.max(...positions));
  return { history, winner };
}
