/**
 * Seeded RNG used to replay the race deterministically from on-chain entropy.
 *
 * The contract emits a combined seed (player1Secret XOR player2Secret XOR blockData).
 * Both clients feed the same seed in here and get the same pothole layout, speed
 * curve, and winner — so the visual replay matches the on-chain outcome.
 *
 * This file is part of /game and MUST NOT import anything from /blockchain.
 */

/** Mulberry32 — small, fast, deterministic PRNG. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a hex string (e.g. 0x... from the contract) into a 32-bit seed. */
export function seedFromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  // fold the hash into 32 bits
  let acc = 0;
  for (let i = 0; i < clean.length; i += 8) {
    acc ^= parseInt(clean.slice(i, i + 8).padEnd(8, '0'), 16) >>> 0;
  }
  return acc >>> 0;
}
