import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

/**
 * Blueprint deploy script for LadaEscrow.
 *
 * Network (chosen via blueprint.config.ts based on --mainnet flag):
 *   testnet (default) → tonhub v4 endpoint
 *   --mainnet          → toncenter v2 endpoint
 *
 * Wallet (mnemonic deployer reads TWO env vars; both case-sensitive):
 *   WALLET_MNEMONIC   24-word seed phrase
 *   WALLET_VERSION    one of: v1r1 v1r2 v1r3 v2r1 v2r2 v3r1 v3r2 v4 v5r1
 *                     (NOTE: lowercase — Blueprint rejects "v5R1")
 *
 * Windows cmd (mainnet):
 *   set WALLET_MNEMONIC=word word ... word
 *   set WALLET_VERSION=v5r1
 *   set TONCENTER_API_KEY=your-key
 *   npx blueprint run deployLadaEscrow --mnemonic --mainnet
 *
 * Init parameters (env overrides bracketed):
 *   owner             — the signing wallet (always)
 *   houseWallet       — [HOUSE_WALLET]        defaults to owner
 *   ladaJettonWallet  — [LADA_JETTON_WALLET]  defaults to LADA_JETTON_WALLET_DEFAULT below
 */

// The Lada jetton wallet for the escrow on mainnet.
// (Override with LADA_JETTON_WALLET env if redeploying for a different jetton.)
const LADA_JETTON_WALLET_DEFAULT = 'EQAfi7cbO6NvAfYXVvftXli1LijUHwinraa8OLO5Nh2MPwkP';

function parseAddrOrDie(value: string, label: string): Address {
  try {
    return Address.parse(value);
  } catch (e: any) {
    console.error(`✗ ${label} address could not be parsed: "${value}"`);
    console.error(`  Reason: ${e?.message || e}`);
    console.error(`  TON friendly addresses are 48 chars and end in a CRC16 checksum.`);
    console.error(`  Double-check the address you copied — one wrong character invalidates`);
    console.error(`  the checksum.`);
    process.exit(1);
  }
}

export async function run(provider: NetworkProvider) {
  const owner = provider.sender().address!;
  const network = provider.network();

  const houseWallet = process.env.HOUSE_WALLET
    ? parseAddrOrDie(process.env.HOUSE_WALLET, 'HOUSE_WALLET')
    : owner;
  const ladaJettonWalletStr = process.env.LADA_JETTON_WALLET || LADA_JETTON_WALLET_DEFAULT;
  const ladaJettonWallet = parseAddrOrDie(ladaJettonWalletStr, 'ladaJettonWallet');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow deployment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Network:        ', network, network === 'mainnet' ? '⚠ REAL TON' : '');
  console.log('  Owner:          ', owner.toString());
  console.log('  House wallet:   ', houseWallet.toString());
  console.log('  Jetton wallet:  ', ladaJettonWallet.toString(),
              process.env.LADA_JETTON_WALLET ? '(env override)' : '(default)');
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

  const explorer = network === 'mainnet'
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
