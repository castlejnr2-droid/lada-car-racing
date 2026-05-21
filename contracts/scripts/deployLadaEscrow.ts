import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

/**
 * Blueprint deploy script for LadaEscrow.
 *
 * ── Network ──────────────────────────────────────────────────────────
 * Endpoint is chosen by blueprint.config.ts based on CLI flag:
 *   npx blueprint run deployLadaEscrow              → testnet (tonhub v4)
 *   npx blueprint run deployLadaEscrow --mainnet    → mainnet (toncenter v2)
 *   npx blueprint run deployLadaEscrow --custom \
 *     --custom-version=v2 --custom-type=testnet \
 *     https://testnet.tonapi.io/api/v2/jsonRPC      → custom (testnet fallback)
 *
 * For mainnet via toncenter, set TONCENTER_API_KEY to raise the rate limit.
 *
 * ── Wallet (signing) ─────────────────────────────────────────────────
 *
 *  TonConnect (default — opens your wallet to sign):
 *    npx blueprint run deployLadaEscrow --tonconnect
 *
 *  Mnemonic (unattended) — Blueprint reads these two env vars:
 *    WALLET_MNEMONIC="word1 word2 … word24"
 *    WALLET_VERSION=v4                        (also accepts v3r2, v5r1, etc.)
 *
 *  Examples:
 *    Linux/macOS:
 *      WALLET_MNEMONIC="word word ... word" WALLET_VERSION=v4 \
 *        npx blueprint run deployLadaEscrow --mnemonic
 *    Windows PowerShell:
 *      $env:WALLET_MNEMONIC = "word word ... word"
 *      $env:WALLET_VERSION  = "v4"
 *      npx blueprint run deployLadaEscrow --mnemonic
 *
 *  IMPORTANT: both vars must be set. Blueprint throws
 *    "Mnemonic deployer was chosen, but env variables WALLET_MNEMONIC and
 *     WALLET_VERSION are not set"
 *  if either is missing or empty.
 *
 * ── Optional deploy params ───────────────────────────────────────────
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
  const network = provider.network();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow deployment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Network:        ', network);
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
