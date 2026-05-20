/**
 * Standalone deploy — bypasses Blueprint's CLI entirely.
 *
 * Why this exists: Blueprint 0.27's `findScripts` (in
 * node_modules/@ton/blueprint/dist/utils/selection.utils.js) reads the
 * `scripts/` directory with `fs.readdir({ recursive: true, withFileTypes: true })`
 * and then calls `dirent.path.slice(...)`. On Node 18.17–20.0 the recursive
 * Dirent lacks a `.path` property, so `.slice` throws
 *   "Cannot read properties of undefined (reading 'slice')"
 * before any script even runs. Newer Node (20.1+) has `.path`; Node 22+
 * also has `.parentPath`. If you're hitting that error and can't upgrade
 * Node, use this script.
 *
 * Run with:
 *   npm run build:contract             # compiles lada_escrow.tact → build/
 *   WALLET_MNEMONIC="word word word…" \
 *   HOUSE_WALLET=0Q… \                 # optional; defaults to deployer
 *   LADA_JETTON_WALLET=0Q… \           # optional; placeholder OK on first deploy
 *   TONCENTER_KEY=… \                  # optional; raises rate limit
 *   npx ts-node tools/deploy.ts
 *
 * After deploy, copy the printed address into:
 *   frontend/.env  →  VITE_ESCROW_CONTRACT_ADDRESS
 *   backend/.env   →  ESCROW_CONTRACT_ADDRESS
 */
import { Address, toNano, internal, SendMode } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

const ENDPOINT = process.env.TON_ENDPOINT
  || 'https://testnet.toncenter.com/api/v2/jsonRPC';

async function main() {
  const mnemonic = (process.env.WALLET_MNEMONIC || '').trim();
  if (!mnemonic) {
    fail(
      'WALLET_MNEMONIC env var is required.\n' +
      '  Get your wallet mnemonic from your TON wallet (Tonkeeper, etc.) — it\'s\n' +
      '  the 24-word recovery phrase. Run:\n' +
      '    WALLET_MNEMONIC="word word ... word" npx ts-node tools/deploy.ts',
    );
  }
  const words = mnemonic.split(/\s+/).filter(Boolean);
  if (words.length !== 24) fail(`WALLET_MNEMONIC must be 24 words (got ${words.length})`);

  const client = new TonClient({ endpoint: ENDPOINT, apiKey: process.env.TONCENTER_KEY });

  // Derive the deployer wallet (v4)
  const keys = await mnemonicToPrivateKey(words);
  const wallet = client.open(
    WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey }),
  );
  const owner = wallet.address;

  // House wallet & jetton wallet (placeholders allowed for the first deploy)
  const houseWallet = process.env.HOUSE_WALLET
    ? Address.parse(process.env.HOUSE_WALLET)
    : owner;
  const ladaJettonWallet = process.env.LADA_JETTON_WALLET
    ? Address.parse(process.env.LADA_JETTON_WALLET)
    : owner;

  // Build init state for the escrow
  const escrow = await LadaEscrow.fromInit(owner, houseWallet, ladaJettonWallet);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow standalone deploy');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Endpoint:        ', ENDPOINT);
  console.log('  Deployer (owner):', owner.toString());
  console.log('  House wallet:    ', houseWallet.toString());
  console.log('  Jetton wallet:   ', ladaJettonWallet.toString(),
              process.env.LADA_JETTON_WALLET ? '' : '(placeholder — redeploy with real value)');
  console.log('  Predicted addr:  ', escrow.address.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check wallet balance before broadcasting
  const balance = await client.getBalance(owner);
  console.log('  Deployer balance:', Number(balance) / 1e9, 'TON');
  if (balance < toNano('0.2')) {
    fail(
      'Deployer wallet has insufficient TON for gas + storage.\n' +
      '  Top it up — testnet faucet: https://t.me/testgiver_ton_bot',
    );
  }

  // Send the deploy: an internal message to the future contract address with
  // (StateInit, Deploy body). The contract's `Deployable` trait handles it.
  console.log('  Broadcasting deploy transaction…');

  const seqno = await wallet.getSeqno();
  await wallet.sendTransfer({
    seqno,
    secretKey: keys.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: escrow.address,
        value: toNano('0.5'),
        init: escrow.init,                       // attaches code+data — actual deploy
        bounce: false,
        body: deployBodyCell(),
      }),
    ],
  });

  // Wait for the seqno to advance — that means the wallet broadcast went through
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const s = await wallet.getSeqno();
    if (s > seqno) break;
  }

  // Then poll the contract address until it shows "active"
  console.log('  Waiting for contract to become active on-chain…');
  let deployed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const state = await client.getContractState(escrow.address);
    if (state.state === 'active') { deployed = true; break; }
  }
  if (!deployed) {
    fail('Timed out waiting for contract to activate. Check tx on the explorer.');
  }

  const explorer = `https://testnet.tonviewer.com/${escrow.address.toString()}`;
  console.log('');
  console.log('  ✓ Deployed!');
  console.log('  Address:  ', escrow.address.toString());
  console.log('  Explorer: ', explorer);
  console.log('');
  console.log('  → Add to your env files:');
  console.log('       ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('       VITE_ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// The Deploy message body for Tact's @stdlib/deploy trait is just:
//   uint32 op = 0x946a98b6, uint64 queryId
// We build it inline to avoid pulling in helpers.
function deployBodyCell() {
  const { beginCell } = require('@ton/core');
  return beginCell().storeUint(0x946a98b6, 32).storeUint(0n, 64).endCell();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(msg: string): never {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
