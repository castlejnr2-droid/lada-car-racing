import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

/**
 * Deploys LadaEscrow to whichever network Blueprint is pointed at
 * (defaults to testnet per blueprint.config.ts).
 *
 * Required env (with sensible fallbacks):
 *   HOUSE_WALLET         — TON address that collects the 5% house fee.
 *                          Defaults to the signing wallet.
 *   LADA_JETTON_WALLET   — this contract's jetton wallet for the Lada jetton.
 *                          For a first-pass deploy, leave unset — the script
 *                          uses the signing wallet as a placeholder. Compute
 *                          the real value by calling get_wallet_address on
 *                          the Lada jetton master with the contract's
 *                          eventual address, then redeploy.
 *
 * Run with:
 *   npx blueprint run deployLadaEscrow              # testnet (default)
 *   npx blueprint run deployLadaEscrow --mainnet
 */
export async function run(provider: NetworkProvider) {
  const owner = provider.sender().address!;
  const houseWallet = process.env.HOUSE_WALLET
    ? Address.parse(process.env.HOUSE_WALLET)
    : owner;
  const ladaJettonWallet = process.env.LADA_JETTON_WALLET
    ? Address.parse(process.env.LADA_JETTON_WALLET)
    : owner;

  const isPlaceholder = !process.env.LADA_JETTON_WALLET;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow deployment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Network:        ', provider.network());
  console.log('  Owner:          ', owner.toString());
  console.log('  House wallet:   ', houseWallet.toString());
  console.log('  Jetton wallet:  ', ladaJettonWallet.toString(),
              isPlaceholder ? '(placeholder — redeploy with real value)' : '');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const escrow = provider.open(
    await LadaEscrow.fromInit(owner, houseWallet, ladaJettonWallet),
  );

  console.log('  Predicted address:', escrow.address.toString());
  console.log('  Sending deploy transaction…');

  await escrow.send(
    provider.sender(),
    { value: toNano('0.5') },
    { $$type: 'Deploy', queryId: 0n },
  );

  await provider.waitForDeploy(escrow.address);

  const explorer = provider.network() === 'mainnet'
    ? `https://tonviewer.com/${escrow.address.toString()}`
    : `https://testnet.tonviewer.com/${escrow.address.toString()}`;

  console.log('');
  console.log('  ✓ Deployed!');
  console.log('  Address:  ', escrow.address.toString());
  console.log('  Explorer: ', explorer);
  console.log('');
  console.log('  → Copy this address into your frontend/backend env as:');
  console.log('       ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
