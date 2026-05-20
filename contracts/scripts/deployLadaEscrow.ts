import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

/**
 * Blueprint deploy script for LadaEscrow.
 *
 * Endpoints (configured in blueprint.config.ts):
 *   primary  https://testnet-v4.tonhubapi.com          (v4 HTTP API)
 *   fallback https://testnet.tonapi.io/api/v2/jsonRPC  (pass via --custom)
 *
 * Run with:
 *   npx blueprint run deployLadaEscrow                 # default (v4 tonhub)
 *   npx blueprint run deployLadaEscrow --custom \
 *     --custom-version=v2 --custom-type=testnet \
 *     https://testnet.tonapi.io/api/v2/jsonRPC          # fallback
 *   npx blueprint run deployLadaEscrow --mainnet        # mainnet
 *
 * Env (optional):
 *   HOUSE_WALLET         — TON address that collects the 5% fee.
 *                          Defaults to the signing wallet.
 *   LADA_JETTON_WALLET   — this contract's jetton wallet for Lada.
 *                          Leave unset on first deploy (uses owner as
 *                          placeholder); redeploy with the real value
 *                          once the jetton master returns it.
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
  console.log('  → Copy this address into your env files as:');
  console.log('       ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('       VITE_ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
