/**
 * Lada escrow contract wrapper.
 *
 * The contract (in /contracts) handles:
 *   - jetton deposits
 *   - commit-reveal RNG
 *   - 95/5 payout split
 *
 * This module is the ONLY place outside /contracts that knows the message
 * shapes. The rest of the app talks to it via these functions.
 */

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;

/** Submit hash(secret) for the given race. */
export async function commitSecret(raceId) {
  // TODO: wire up to TonConnect once contract ABI is finalized
  console.log('[escrow] commit', raceId);
}

/** Reveal the secret so the contract can derive the winner. */
export async function revealSecret(raceId) {
  // TODO: wire up to TonConnect once contract ABI is finalized
  console.log('[escrow] reveal', raceId);
}

/**
 * Listen for the WinnerDeclared event for a specific race.
 * Returns an unsubscribe function.
 */
export function subscribeToWinner(raceId, callback) {
  // TODO: replace with TonAPI / Tonscan event subscription
  console.log('[escrow] subscribe', raceId);
  return () => {};
}

export { ESCROW_ADDRESS };
