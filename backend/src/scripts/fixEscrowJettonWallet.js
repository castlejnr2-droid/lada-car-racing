/**
 * One-shot script: send SetJettonWallet to the live escrow contract.
 *
 * This fixes the misconfiguration where the escrow was deployed with the house
 * wallet address as its ladaJettonWallet instead of the correct LADA jetton
 * wallet derived from the LADA master for the escrow address.
 *
 * After running this, jettonWalletAddress() on the escrow will return:
 *   EQAfi7cbO6NvAfYXVvftXli1LijUHwinraa8OLO5Nh2MPwkP
 *
 * Run from the backend/ directory:
 *   node src/scripts/fixEscrowJettonWallet.js
 *
 * Required env vars (same as the backend needs to operate):
 *   HOUSE_WALLET_MNEMONIC
 *   ESCROW_CONTRACT_ADDRESS
 *   TON_NETWORK=mainnet          (or omit — defaults to mainnet check)
 *   TONCENTER_API_KEY            (optional but recommended)
 */
import 'dotenv/config';
import { setEscrowJettonWallet } from '../services/housePayout.js';
import { TonClient }             from '@ton/ton';
import { Address, beginCell }    from '@ton/core';
import { config }                from '../config.js';

const ESCROW_ADDR = 'EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ';
const LADA_MASTER = 'EQBjNisz_m-sdA9TcosQMmugdhl6hDjGcCMgQFa85p_8jx7p';

async function verifyAfter() {
  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: config.ton.apiKey || undefined,
  });

  // Poll until the new value is visible on-chain (up to ~30 s).
  const expected = '0:1f8bb71b3ba36f01f61756f7ed5e58b52e28d41f08a7ada6bc38b3b9361d8c3f';
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await client.runMethod(Address.parse(ESCROW_ADDR), 'jettonWalletAddress', []);
      const addr = res.stack.readAddress();
      if (addr.toRawString() === expected) {
        console.log('\n✓ Verified on-chain — escrow now reports the correct LADA jetton wallet:');
        console.log('  ', addr.toString({ urlSafe: true, bounceable: true }));
        return true;
      }
      console.log(`  [${i + 1}/15] still showing old value, retrying…`);
    } catch (e) {
      console.log(`  [${i + 1}/15] getter error: ${e.message}, retrying…`);
    }
  }
  console.log('\n⚠  Timed out waiting for on-chain confirmation.');
  console.log('   Check tonviewer for the SetJettonWallet transaction.');
  return false;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  fixEscrowJettonWallet — one-shot patch');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Escrow  :', ESCROW_ADDR);
  console.log('  Network :', config.ton.network);
  console.log('  Setting ladaJettonWallet to the address derived from LADA master:');
  console.log('  Master  :', LADA_MASTER);
  console.log('  Wallet  : EQAfi7cbO6NvAfYXVvftXli1LijUHwinraa8OLO5Nh2MPwkP');
  console.log('');

  if (config.ton.network !== 'mainnet') {
    console.error('✗ TON_NETWORK is not "mainnet" — aborting to avoid patching the wrong network.');
    console.error('  Set TON_NETWORK=mainnet in your env and retry.');
    process.exit(1);
  }

  console.log('Sending SetJettonWallet…');
  await setEscrowJettonWallet();
  console.log('Transaction sent. Waiting for on-chain confirmation…');

  await verifyAfter();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((e) => { console.error(e); process.exit(1); });
