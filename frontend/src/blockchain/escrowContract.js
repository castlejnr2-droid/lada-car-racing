/**
 * Lada escrow contract wrapper.
 *
 * Constructs the message bodies for the contract's three player-facing
 * operations (commit, reveal, timeout-refund) and sends them via TonConnect.
 *
 * Op-codes here MUST match `message(0x....)` declarations in
 *   contracts/contracts/lada_escrow.tact
 *
 * This is the ONLY frontend file outside /blockchain that knows the contract
 * message layout. The rest of the app calls these helpers.
 */
import { Address, beginCell, toNano } from '@ton/core';

// Op-codes — keep in sync with the contract
export const OP = {
  CommitHash:    0x6c726301,
  RevealSecret:  0x6c726302,
  TimeoutRefund: 0x6c726303,
};

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;

function escrowAddress() {
  if (!ESCROW_ADDRESS) throw new Error('VITE_ESCROW_CONTRACT_ADDRESS not configured');
  return ESCROW_ADDRESS;
}

function tx({ to, amount, body }) {
  return {
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [{
      address: to,
      amount: amount.toString(),
      payload: body.toBoc().toString('base64'),
    }],
  };
}

// ───── Commit ─────────────────────────────────────────────────────────
export function buildCommit(raceIdOnChain, commitBigInt) {
  const body = beginCell()
    .storeUint(OP.CommitHash, 32)
    .storeUint(BigInt(raceIdOnChain), 64)
    .storeUint(commitBigInt, 256)
    .endCell();
  return tx({ to: escrowAddress(), amount: toNano('0.05'), body });
}

// ───── Reveal ─────────────────────────────────────────────────────────
export function buildReveal(raceIdOnChain, secretBigInt) {
  const body = beginCell()
    .storeUint(OP.RevealSecret, 32)
    .storeUint(BigInt(raceIdOnChain), 64)
    .storeUint(secretBigInt, 256)
    .endCell();
  // settle path may send 2 jetton transfers → fund more
  return tx({ to: escrowAddress(), amount: toNano('0.2'), body });
}

// ───── Timeout refund ─────────────────────────────────────────────────
export function buildTimeoutRefund(raceIdOnChain) {
  const body = beginCell()
    .storeUint(OP.TimeoutRefund, 32)
    .storeUint(BigInt(raceIdOnChain), 64)
    .endCell();
  return tx({ to: escrowAddress(), amount: toNano('0.2'), body });
}

export { ESCROW_ADDRESS };
