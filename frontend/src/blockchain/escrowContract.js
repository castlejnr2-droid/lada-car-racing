/**
 * LadaEscrow v2 — op codes reference (for indexer / backend).
 *
 * Players only sign ONE transaction: their jetton deposit (see jetton.js).
 * All remaining contract ops (Payout, Refund) are called by the house wallet
 * on the backend — no frontend interaction needed.
 */
export const OP = {
  CreateRace:       0x6c726300,
  Payout:           0x6c726304,
  Refund:           0x6c726305,
  WithdrawJettons:  0x6c726306,
  SetJettonWallet:  0x6c726307,
  WinnerDeclared:   0x6c7263f1,
  RaceRefunded:     0x6c7263f2,
};

export const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;
