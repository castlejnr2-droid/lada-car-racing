import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import { LadaEscrow, OP, commitOf, buildDepositForwardPayload } from '../wrappers/LadaEscrow';

// Once `npm run build` has been run, swap the import below in and use the
// generated `fromInit` for typed deployment:
//
//   import { LadaEscrow } from '../build/LadaEscrow/tact_LadaEscrow';
//
// The hand-written wrapper above keeps test source compiling before build.

/**
 * NOTE: these tests are scaffolded but mostly skipped until `npm run build`
 * generates the typed Tact wrapper. The flow each `it.todo` describes is
 * documented in comments so they can be filled in once the contract is built.
 */
describe('LadaEscrow', () => {
  let blockchain: Blockchain;
  let owner: SandboxContract<TreasuryContract>;
  let house: SandboxContract<TreasuryContract>;
  let mockJettonWallet: SandboxContract<TreasuryContract>;
  let player1: SandboxContract<TreasuryContract>;
  let player2: SandboxContract<TreasuryContract>;

  // Replace with: SandboxContract<TactLadaEscrow> after build
  // let escrow: SandboxContract<LadaEscrow>;

  const RACE_ID = 1n;
  const STAKE = toNano('10'); // 10 LADA (nano-units)

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    owner            = await blockchain.treasury('owner');
    house            = await blockchain.treasury('house');
    mockJettonWallet = await blockchain.treasury('mockJettonWallet');
    player1          = await blockchain.treasury('player1');
    player2          = await blockchain.treasury('player2');

    // After `npm run build`:
    //
    // escrow = blockchain.openContract(await TactLadaEscrow.fromInit(
    //   owner.address, house.address, mockJettonWallet.address,
    // ));
    // const deployRes = await escrow.send(
    //   owner.getSender(),
    //   { value: toNano('0.5') },
    //   { $$type: 'Deploy', queryId: 0n },
    // );
    // expect(deployRes.transactions).toHaveTransaction({
    //   from: owner.address,
    //   to: escrow.address,
    //   deploy: true,
    //   success: true,
    // });
  });

  // ─── Sanity checks on helpers ────────────────────────────────────

  it('commitOf is deterministic and matches the contract sha256(secret)', async () => {
    const secret = 0x1234567890abcdefn;
    const c1 = await commitOf(secret);
    const c2 = await commitOf(secret);
    expect(c1).toBe(c2);
    expect(c1).not.toBe(0n);
  });

  it('buildDepositForwardPayload encodes the race id as the first 64 bits', () => {
    const payload = buildDepositForwardPayload(RACE_ID);
    const slice = payload.beginParse();
    expect(slice.loadUintBig(64)).toBe(RACE_ID);
  });

  // ─── Contract behaviour (fill in after build) ────────────────────

  it.todo('CreateRace rejects callers that are not the owner');
  it.todo('CreateRace rejects duplicate raceIds');
  it.todo('CreateRace rejects player1 == player2');

  // Deposits
  it.todo('TokenNotification rejects non-jetton-wallet senders');
  it.todo('TokenNotification refunds jettons for an unknown race');
  it.todo('TokenNotification refunds jettons with the wrong amount');
  it.todo('TokenNotification refunds jettons for a non-player address');
  it.todo('TokenNotification refunds duplicate deposits from the same player');
  it.todo('TokenNotification advances state to AWAITING_COMMITS once both deposits land');

  // Commits
  it.todo('CommitHash rejects messages from non-players');
  it.todo('CommitHash rejects a second commit from the same player');
  it.todo('CommitHash rejects after the commit deadline');
  it.todo('CommitHash advances state to AWAITING_REVEALS once both commits land');

  // Reveals
  it.todo('RevealSecret rejects a secret whose sha256 does not match the commit');
  it.todo('RevealSecret rejects messages from non-players');
  it.todo('RevealSecret rejects after the reveal deadline');

  // Settlement
  it.todo('On both reveals: emits WinnerDeclared with the correct seed');
  it.todo('On both reveals: 95% of pot goes to winner via jetton transfer');
  it.todo('On both reveals: 5% of pot goes to house wallet via jetton transfer');
  it.todo('On both reveals: race is deleted from storage');

  // Refunds
  it.todo('TimeoutRefund fails before the deadline');
  it.todo('TimeoutRefund refunds both players if the reveal deadline passes');
  it.todo('TimeoutRefund refunds only deposited players if a deposit is missing');
  it.todo('TimeoutRefund emits RaceRefunded');
  it.todo('TimeoutRefund is callable by anyone (not just players)');

  // Owner ops
  it.todo('withdrawTon transfers contract TON balance back to owner');
  it.todo('withdrawTon rejects non-owner callers');
});
