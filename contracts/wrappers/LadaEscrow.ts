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
 * Hand-written facade around the LadaEscrow Tact contract.
 *
 * After `npm run build` Blueprint generates a fully typed wrapper at
 *   build/LadaEscrow/tact_LadaEscrow.ts
 * with `LadaEscrow.fromInit(...)` and message constructors. Tests and
 * the deploy script should prefer that wrapper. This file is a stable
 * shape the rest of the codebase can import while the contract evolves.
 *
 * Op-codes here MUST match the `message(0x....)` declarations in
 * contracts/lada_escrow.tact.
 */

// Op-codes — keep in sync with lada_escrow.tact
export const OP = {
  CreateRace:    0x6c726300,
  CommitHash:    0x6c726301,
  RevealSecret:  0x6c726302,
  TimeoutRefund: 0x6c726303,
  // Outgoing events the frontend / indexer listens for
  WinnerDeclared: 0x6c7263f1,
  RaceRefunded:   0x6c7263f2,
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

  // ── Send: commit hash(secret) ───────────────────────────────────
  async sendCommitHash(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; commit: bigint; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.CommitHash, 32)
      .storeUint(args.raceId, 64)
      .storeUint(args.commit, 256)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: reveal the secret ─────────────────────────────────────
  async sendRevealSecret(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; secret: bigint; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.RevealSecret, 32)
      .storeUint(args.raceId, 64)
      .storeUint(args.secret, 256)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.2'), // settle path may send 2 jetton txs
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Send: trigger a refund after the deadline ───────────────────
  async sendTimeoutRefund(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; value?: bigint },
  ) {
    const body = beginCell()
      .storeUint(OP.TimeoutRefund, 32)
      .storeUint(args.raceId, 64)
      .endCell();

    await provider.internal(via, {
      value: args.value ?? toNano('0.2'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  // ── Get methods ─────────────────────────────────────────────────
  async getRace(provider: ContractProvider, raceId: bigint) {
    const { stack } = await provider.get('raceOf', [
      { type: 'int', value: raceId },
    ]);
    // The race struct is returned as a tuple — typed parsing is generated
    // by Tact after `npm run build`. Return the raw stack for now.
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
 * Compute sha256(uint256 secret) → uint256 commit, the same way the contract
 * verifies it. Frontends and tests should use this helper so they agree.
 */
export async function commitOf(secret: bigint): Promise<bigint> {
  const { sha256 } = await import('@ton/crypto');
  const buf = Buffer.alloc(32);
  // big-endian 256-bit
  let s = secret;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  const digest = await sha256(buf);
  return BigInt('0x' + digest.toString('hex'));
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
