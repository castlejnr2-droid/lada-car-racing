import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
// import { LadaEscrow } from '../build/LadaEscrow/tact_LadaEscrow';

/**
 * Deploy the LadaEscrow contract.
 *
 * Required env vars (or interactive prompt):
 *   HOUSE_WALLET         — TON address that collects the 5% fee
 *   LADA_JETTON_WALLET   — this contract's Lada jetton wallet
 *                          (must be precomputed against the deploy address;
 *                          for the MVP, deploy the contract first with a
 *                          placeholder then update — or precompute using
 *                          the Lada jetton master `get_wallet_address`)
 */
export async function run(provider: NetworkProvider) {
  const owner = provider.sender().address!;
  const houseWallet = process.env.HOUSE_WALLET
    ? Address.parse(process.env.HOUSE_WALLET)
    : owner;
  const ladaJettonWallet = process.env.LADA_JETTON_WALLET
    ? Address.parse(process.env.LADA_JETTON_WALLET)
    : owner; // placeholder for first-pass deploy

  console.log('Owner:        ', owner.toString());
  console.log('House wallet: ', houseWallet.toString());
  console.log('Lada jetton:  ', ladaJettonWallet.toString());

  // Uncomment after `npm run build`:
  //
  // const escrow = provider.open(await LadaEscrow.fromInit(
  //   owner, houseWallet, ladaJettonWallet,
  // ));
  // await escrow.send(
  //   provider.sender(),
  //   { value: toNano('0.5') },
  //   { $$type: 'Deploy', queryId: 0n },
  // );
  // await provider.waitForDeploy(escrow.address);
  // console.log('LadaEscrow deployed at', escrow.address.toString());

  console.log('Run `npm run build` first, then uncomment the deploy block above.');
}
