import {
  Address,
  Cell,
  Contract,
  ContractProvider,
  Sender,
  SendMode,
  beginCell,
  contractAddress,
  toNano,
} from '@ton/core';

/**
 * Thin TypeScript wrapper around the LadaEscrow Tact contract.
 *
 * Once `npm run build` has been run, Blueprint generates a typed
 * wrapper at `build/LadaEscrow/tact_LadaEscrow.ts`. This file is a
 * hand-written facade so the rest of the codebase (and tests) have
 * a stable import path even while the Tact contract evolves.
 */
export class LadaEscrow implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell },
  ) {}

  static createFromAddress(address: Address) {
    return new LadaEscrow(address);
  }

  async sendCreateRace(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; stake: bigint; maxPlayers: number },
  ) {
    const body = beginCell()
      .storeUint(0x1234, 32) // op-code placeholder — replace with generated one from Tact
      .storeUint(args.raceId, 64)
      .storeCoins(args.stake)
      .storeUint(args.maxPlayers, 8)
      .endCell();

    await provider.internal(via, {
      value: toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendCommitHash(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; commit: bigint },
  ) {
    const body = beginCell()
      .storeUint(0x1235, 32)
      .storeUint(args.raceId, 64)
      .storeUint(args.commit, 256)
      .endCell();

    await provider.internal(via, {
      value: toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendRevealSecret(
    provider: ContractProvider,
    via: Sender,
    args: { raceId: bigint; secret: bigint },
  ) {
    const body = beginCell()
      .storeUint(0x1236, 32)
      .storeUint(args.raceId, 64)
      .storeUint(args.secret, 256)
      .endCell();

    await provider.internal(via, {
      value: toNano('0.05'),
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async getRace(provider: ContractProvider, raceId: bigint) {
    const { stack } = await provider.get('raceOf', [
      { type: 'int', value: raceId },
    ]);
    return stack;
  }
}
