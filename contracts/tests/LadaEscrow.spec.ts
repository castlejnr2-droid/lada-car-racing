import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import '@ton/test-utils';

// import { LadaEscrow } from '../build/LadaEscrow/tact_LadaEscrow';  // generated after build

describe('LadaEscrow', () => {
  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let player1:  SandboxContract<TreasuryContract>;
  let player2:  SandboxContract<TreasuryContract>;
  // let escrow:   SandboxContract<LadaEscrow>;

  beforeAll(async () => {
    blockchain = await Blockchain.create();
    deployer = await blockchain.treasury('deployer');
    player1  = await blockchain.treasury('player1');
    player2  = await blockchain.treasury('player2');

    // escrow = blockchain.openContract(await LadaEscrow.fromInit(
    //   deployer.address, deployer.address, deployer.address,
    // ));
    // const deployRes = await escrow.send(deployer.getSender(),
    //   { value: toNano('0.1') }, { $$type: 'Deploy', queryId: 0n });
    // expect(deployRes.transactions).toHaveTransaction({ from: deployer.address, success: true });
  });

  it('placeholder — replace once contract is built', () => {
    expect(true).toBe(true);
  });

  it.todo('rejects a CommitHash before deposit');
  it.todo('locks the race once all commits are in');
  it.todo('rejects a Reveal whose hash does not match the commit');
  it.todo('pays 95% to winner and 5% to house wallet');
  it.todo('refunds both players if reveal deadline passes');
});
