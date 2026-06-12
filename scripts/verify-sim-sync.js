#!/usr/bin/env node
/**
 * verify-sim-sync.js
 *
 * Runs both the frontend and backend physics implementations over N random
 * seeds and asserts identical winners. A single mismatch means the two
 * codebases have drifted and real-money races could show the wrong winner.
 *
 * Usage (from repo root):
 *   node scripts/verify-sim-sync.js
 *   node scripts/verify-sim-sync.js 5000   # custom seed count
 *
 * The frontend modules are imported directly via Node's native ESM support.
 * The backend simulation is inlined here (it cannot be imported without
 * pulling in pg / TON SDK). Keep it byte-for-byte in sync with the copy in
 * backend/src/services/events.js (search for "computeWinnerIndex").
 */

import { createRng, seedFromHex }    from '../frontend/src/game/rng.js';
import { buildTrack, simulate, TRACK_LENGTH, POTHOLES_PER_LANE } from '../frontend/src/game/physics.js';

// ─── Backend implementation (inlined — must mirror events.js exactly) ──────────

function _seedFromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  let acc = 0;
  for (let i = 0; i < clean.length; i += 8) {
    acc ^= parseInt(clean.slice(i, i + 8).padEnd(8, '0'), 16) >>> 0;
  }
  return acc >>> 0;
}

function _createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _TRACK_LENGTH      = 1200;
const _POTHOLES_PER_LANE = 14;
const _BASE_SPEED        = 6;
const _POTHOLE_PENALTY   = 0.35;
const _POTHOLE_HIT_RAD   = 5;
const _MAX_TICKS         = 600;

function backendWinner(seedHex) {
  const rng = _createRng(_seedFromHex(seedHex));

  const lanes = [];
  for (let l = 0; l < 2; l++) {
    const potholes = [];
    for (let i = 0; i < _POTHOLES_PER_LANE; i++) {
      potholes.push(80 + Math.floor(rng() * (_TRACK_LENGTH - 80)));
    }
    lanes.push({ potholes: potholes.sort((a, b) => a - b) });
  }

  const positions = [0, 0];
  let tick = 0;
  while (positions.some((p) => p < _TRACK_LENGTH) && tick < _MAX_TICKS) {
    for (let i = 0; i < 2; i++) {
      if (positions[i] >= _TRACK_LENGTH) continue;
      const onPothole = lanes[i].potholes.some(
        (p) => Math.abs(p - positions[i]) < _POTHOLE_HIT_RAD,
      );
      const jitter = 0.85 + rng() * 0.3;
      positions[i] += _BASE_SPEED * (onPothole ? _POTHOLE_PENALTY : 1) * jitter;
    }
    tick++;
  }

  return positions[1] > positions[0] ? 1 : 0;
}

// ─── Frontend wrapper ──────────────────────────────────────────────────────────

function frontendWinner(seedHex) {
  const rng   = createRng(seedFromHex(seedHex));
  const track = buildTrack(rng, 2);
  const sim   = simulate(track, rng);
  return sim.winner;
}

// ─── Constant cross-check ──────────────────────────────────────────────────────

function assertConstants() {
  const errors = [];
  if (TRACK_LENGTH      !== _TRACK_LENGTH)      errors.push(`TRACK_LENGTH: frontend=${TRACK_LENGTH} backend=${_TRACK_LENGTH}`);
  if (POTHOLES_PER_LANE !== _POTHOLES_PER_LANE) errors.push(`POTHOLES_PER_LANE: frontend=${POTHOLES_PER_LANE} backend=${_POTHOLES_PER_LANE}`);
  // BASE_SPEED, POTHOLE_PENALTY, HIT_RAD, MAX_TICKS are not exported from physics.js;
  // their correctness is proven by the winner agreement test below.
  if (errors.length) {
    console.error('Constant mismatch BEFORE running seeds:');
    errors.forEach(e => console.error(' ', e));
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function randomSeedHex() {
  return Array.from({ length: 8 }, () =>
    (Math.random() * 0x100000000 >>> 0).toString(16).padStart(8, '0'),
  ).join('');
}

const N = parseInt(process.argv[2] || '1000', 10);

assertConstants();

let mismatches = 0;
const firstMismatches = [];
const wins = [0, 0];   // wins[0] = player 1 (lane 0) wins, wins[1] = player 2 (lane 1) wins

for (let i = 0; i < N; i++) {
  const seed = randomSeedHex();
  const fe   = frontendWinner(seed);
  const be   = backendWinner(seed);
  wins[fe]++;
  if (fe !== be) {
    mismatches++;
    if (firstMismatches.length < 5) {
      firstMismatches.push({ seed, frontend: fe, backend: be });
    }
  }
}

// Win-split report — lane 0 and lane 1 have independent pothole layouts so a
// small asymmetry is expected. A large skew would indicate a structural bias
// worth investigating (but never change sim logic based on this alone).
const p1pct = (wins[0] / N * 100).toFixed(2);
const p2pct = (wins[1] / N * 100).toFixed(2);
console.log(`Win split (${N} seeds): player1 (lane 0) ${p1pct}%  |  player2 (lane 1) ${p2pct}%`);

if (mismatches === 0) {
  console.log(`OK  ${N} seeds tested — frontend and backend produce identical winners.`);
  process.exit(0);
} else {
  console.error(`FAIL  ${mismatches}/${N} seeds produced different winners!`);
  console.error('First mismatches:');
  firstMismatches.forEach(({ seed, frontend, backend }) =>
    console.error(`  seed=${seed}  frontend=${frontend}  backend=${backend}`),
  );
  console.error('');
  console.error('The two physics implementations have drifted.');
  console.error('Fix: ensure BASE_SPEED, POTHOLE_PENALTY, HIT_RAD, MAX_TICKS, and');
  console.error('RNG call order are identical in physics.js and events.js.');
  process.exit(1);
}
