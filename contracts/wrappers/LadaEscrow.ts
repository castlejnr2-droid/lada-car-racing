import {
  Address,
  Cell,
  Contract,
  ContractProvider,
  Sender,
  SendMode,
  beginCell,
  toNano,
} from '@ton/core';

/**
 * Hand-written facade around the LadaEscrow Tact contract (v2 — owner payout).
 *
 * Op-codes here MUST match the `message(0x....)` declarations in
 * contracts/lada_escrow.tact.
 */

export const OP = {
  // Incoming
  CreateRace:       0x6c726300,
  Payout:           0x6c726304,
  Refund:           0x6c726305,
  WithdrawJettons:  0x6c726306,
  SetJettonWallet:  0x6c726307,
  // Outgoing events (indexed by backend)
  WinnerDeclared:   0x6c7263f1,
  RaceRefunded:     0x6c7263f2,
} as const;

export class LadaEscrow implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell },
  ) {}

  static createFromAddress(address: Address) {
    return new LadaEscrow(address);
  }

  // ── Send: create a new race (owner only) ────────────────────────
  async sendCreateRace(
    provider: ContractProvider,
    via: Sender,
    args: {
      raceId: bigint;
      stake: bigint;
      player1: Address;
      player2: Address;
      value?: bigint;
    },
  ) {
    const body = beginCell()
      .storeUint(OP.CreateRace, 32)
      .storeUint(args.raceId, 64)
      .storeCoins(args.stake)
      .storeAddress(args.player1)
      .storeAddress(args.player2)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: payout winner (owner only) ────────────────────────────
  async sendPayout(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; winner: Address; seed: bigint; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.Payout, 32)
      .storeUint(args.raceId, 64)
      .storeAddress(args.winner)
      .storeUint(args.seed, 256)
      .endCell();

    await provider.internal(via, {
      // settle sends one jetton transfer, so fund generously
      value: args.value ?? toNano('0.1'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: refund both players (owner only) ───────────────────────
  async sendRefund(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.Refund, 32)
      .storeUint(args.raceId, 64)
      .endCell();

    await provider.internal(via, {
      // may send up to 2 jetton transfers
      value: args.value ?? toNano('0.15'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: withdraw accumulated house fees (owner only) ───────────
  async sendWithdrawJettons(
    provider: ContractProvider,
    via: Sender,
    args: { amount: bigint; to: Address; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.WithdrawJettons, 32)
      .storeCoins(args.amount)
      .storeAddress(args.to)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.1'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: set jetton wallet (owner only, once after deploy) ──────
  async sendSetJettonWallet(
    provider: ContractProvider,
    via: Sender,
    args: { wallet: Address; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.SetJettonWallet, 32)
      .storeAddress(args.wallet)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Get methods ─────────────────────────────────────────────────
  async getRace(provider: ContractProvider, raceId: bigint) {
    const { stack } = await provider.get('raceOf', [
      { type: 'int', value: raceId },
    ]);
    return stack;
  }

  async getOwner(provider: ContractProvider): Promise<Address> {
    const { stack } = await provider.get('owner', []);
    return stack.readAddress();
  }

  async getHouseWalletAddress(provider: ContractProvider): Promise<Address> {
    const { stack } = await provider.get('houseWalletAddress', []);
    return stack.readAddress();
  }

  async getJettonWalletAddress(provider: ContractProvider): Promise<Address> {
    const { stack } = await provider.get('jettonWalletAddress', []);
    return stack.readAddress();
  }
}

/**
 * Build the forward-payload slice that should accompany a Lada jetton
 * transfer so the escrow contract knows which race the deposit is for.
 *
 * The contract reads the first 64 bits of the forward payload as the race ID.
 */
export function buildDepositForwardPayload(raceId: bigint): Cell {
  return beginCell().storeUint(raceId, 64).endCell();
}
