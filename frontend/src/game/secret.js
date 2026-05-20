/**
 * Commit-reveal helpers used by the Race flow.
 *
 *   secret    — random 256-bit BigInt the player generates locally
 *   commit    — sha256(secret as 32-byte big-endian) — the value sent on-chain
 *
 * The contract verifies commit by recomputing sha256 from the stored secret
 * when the player reveals. This file MUST match how the contract hashes:
 * see contracts/lada_escrow.tact's RevealSecret handler.
 *
 * Lives in /game (not /blockchain) because it's a pure deterministic helper
 * with no chain dependencies. Same code is duplicated in
 * contracts/wrappers/LadaEscrow.ts for tests — keep them in sync.
 */

/** Random 256-bit secret as a BigInt. */
export function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** sha256(secret as 32-byte big-endian uint256) → BigInt. */
export async function commitOf(secret) {
  const buf = new Uint8Array(32);
  let s = secret;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let out = 0n;
  for (const b of new Uint8Array(digest)) out = (out << 8n) | BigInt(b);
  return out;
}

// ───── localStorage persistence ───────────────────────────────────────
//
// We must remember the secret across reloads so the player can still reveal
// after closing the app. Stored by race id (UUID from the backend).

const key = (raceId) => `lada:race:${raceId}:secret`;

export function saveSecret(raceId, secret) {
  try { localStorage.setItem(key(raceId), secret.toString()); } catch {}
}

export function loadSecret(raceId) {
  try {
    const v = localStorage.getItem(key(raceId));
    return v ? BigInt(v) : null;
  } catch { return null; }
}

export function clearSecret(raceId) {
  try { localStorage.removeItem(key(raceId)); } catch {}
}
