/**
 * Lada jetton helpers — balance lookup and transfer message construction.
 */

const LADA_MASTER = import.meta.env.VITE_LADA_JETTON_MASTER;

export async function getLadaBalance(address) {
  // TODO: query the jetton wallet of `address` via TonAPI
  console.log('[jetton] balance for', address);
  return 0n;
}

export function buildJettonTransfer({ to, amount, forwardPayload }) {
  // TODO: construct a TEP-74 transfer message
  return {
    address: LADA_MASTER,
    amount: '50000000', // 0.05 TON for gas
    payload: undefined,
  };
}
