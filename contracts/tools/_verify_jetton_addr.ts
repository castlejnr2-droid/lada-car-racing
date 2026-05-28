/**
 * Verifies that the escrow contract's stored jetton wallet matches the
 * address the LADA master would derive for it.
 *
 * Usage (from contracts/):
 *   npx ts-node tools/_verify_jetton_addr.ts
 *
 * Optionally set TONCENTER_API_KEY env var for higher rate limits.
 */
import { Address, beginCell } from '@ton/core';
import { TonClient }          from '@ton/ton';
import { LadaEscrow }         from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

const ESCROW_ADDR   = process.env.ESCROW_ADDR || 'EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ';
const LADA_MASTER   = 'EQBjNisz_m-sdA9TcosQMmugdhl6hDjGcCMgQFa85p_8jx7p';
const ENDPOINT      = 'https://toncenter.com/api/v2/jsonRPC';

async function main() {
  const client = new TonClient({
    endpoint: ENDPOINT,
    apiKey: process.env.TONCENTER_API_KEY || undefined,
  });

  const escrowAddr = Address.parse(ESCROW_ADDR);
  const ladaMaster = Address.parse(LADA_MASTER);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow jetton-wallet verification (mainnet)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Escrow contract :', ESCROW_ADDR);
  console.log('  LADA master     :', LADA_MASTER);
  console.log('');

  // ── 1. Read jettonWalletAddress() from the deployed escrow ─────────────────
  let storedWallet: Address;
  try {
    const escrow = client.open(LadaEscrow.fromAddress(escrowAddr));
    storedWallet = await escrow.getJettonWalletAddress();
    console.log('  [1] Escrow stored jettonWalletAddress()');
    console.log('       bounceable :', storedWallet.toString({ urlSafe: true, bounceable: true }));
    console.log('       non-bounce :', storedWallet.toString({ urlSafe: true, bounceable: false }));
    console.log('       raw        :', storedWallet.toRawString());
  } catch (e: any) {
    console.error('  ✗ Failed to call jettonWalletAddress() on escrow:', e.message);
    process.exit(1);
  }

  // ── 2. Derive expected wallet via get_wallet_address on LADA master ─────────
  let derivedWallet: Address;
  try {
    const result = await client.runMethod(
      ladaMaster,
      'get_wallet_address',
      [{ type: 'slice', cell: beginCell().storeAddress(escrowAddr).endCell() }],
    );
    derivedWallet = result.stack.readAddress();
    console.log('');
    console.log('  [2] LADA master get_wallet_address(escrow)');
    console.log('       bounceable :', derivedWallet.toString({ urlSafe: true, bounceable: true }));
    console.log('       non-bounce :', derivedWallet.toString({ urlSafe: true, bounceable: false }));
    console.log('       raw        :', derivedWallet.toRawString());
  } catch (e: any) {
    console.error('  ✗ Failed to call get_wallet_address on LADA master:', e.message);
    process.exit(1);
  }

  // ── 3. Compare ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const match = storedWallet.toRawString() === derivedWallet.toRawString();
  if (match) {
    console.log('  ✓  MATCH — escrow is correctly configured for LADA');
  } else {
    console.log('  ✗  MISMATCH — escrow was deployed with the wrong jetton wallet!');
    console.log('     Stored   :', storedWallet.toRawString());
    console.log('     Expected :', derivedWallet.toRawString());
    console.log('');
    console.log('  → You must redeploy the escrow with the correct LADA_JETTON_WALLET');
    console.log('    (derived from master', LADA_MASTER, 'for escrow', ESCROW_ADDR, ')');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((e) => { console.error(e); process.exit(1); });
