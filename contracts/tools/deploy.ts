/**
 * Standalone deploy — bypasses Blueprint's CLI entirely.
 *
 * Endpoint chain (tries in order, falls through on connection failure):
 *   1. https://testnet-v4.tonhubapi.com           (v4 HTTP API, no key)
 *   2. https://testnet.tonapi.io/api/v2/jsonRPC   (v2 jsonRPC fallback)
 *
 * Override with TON_ENDPOINT (and optional TON_ENDPOINT_VERSION=v4|v2).
 *
 * Run:
 *   npm run build                                    # compile lada_escrow.tact
 *   WALLET_MNEMONIC="24-word seed phrase" \
 *   HOUSE_WALLET=0Q… \                               # optional
 *   LADA_JETTON_WALLET=0Q… \                         # optional
 *   npm run deploy:standalone
 */
import { Address, toNano, internal, SendMode, beginCell } from '@ton/core';
import { TonClient, TonClient4, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { LadaEscrow } from '../build/LadaEscrow/LadaEscrow_LadaEscrow';

type V4Client = { kind: 'v4'; client: TonClient4; endpoint: string };
type V2Client = { kind: 'v2'; client: TonClient;  endpoint: string };
type AnyClient = V4Client | V2Client;

const ENDPOINTS: Array<{ kind: 'v4' | 'v2'; url: string }> = (() => {
  // Custom override via env
  if (process.env.TON_ENDPOINT) {
    const kind = (process.env.TON_ENDPOINT_VERSION || 'v4').toLowerCase() === 'v2' ? 'v2' : 'v4';
    return [{ kind, url: process.env.TON_ENDPOINT }];
  }
  return [
    { kind: 'v4', url: 'https://testnet-v4.tonhubapi.com' },
    { kind: 'v2', url: 'https://testnet.tonapi.io/api/v2/jsonRPC' },
  ];
})();

async function connect(): Promise<AnyClient> {
  for (const ep of ENDPOINTS) {
    try {
      if (ep.kind === 'v4') {
        const c = new TonClient4({ endpoint: ep.url });
        await c.getLastBlock();
        console.log(`[deploy] connected via v4 → ${ep.url}`);
        return { kind: 'v4', client: c, endpoint: ep.url };
      } else {
        const c = new TonClient({ endpoint: ep.url });
        await c.getMasterchainInfo();
        console.log(`[deploy] connected via v2 → ${ep.url}`);
        return { kind: 'v2', client: c, endpoint: ep.url };
      }
    } catch (e: any) {
      console.warn(`[deploy] ${ep.url} unreachable: ${e?.message || e}. Trying next…`);
    }
  }
  throw new Error('No TON endpoint reachable. Set TON_ENDPOINT to a working RPC.');
}

async function getBalance(c: AnyClient, addr: Address): Promise<bigint> {
  if (c.kind === 'v2') return await c.client.getBalance(addr);
  const last = await c.client.getLastBlock();
  const acc  = await c.client.getAccountLite(last.last.seqno, addr);
  return BigInt(acc.account.balance.coins);
}

async function isActive(c: AnyClient, addr: Address): Promise<boolean> {
  if (c.kind === 'v2') {
    const s = await c.client.getContractState(addr);
    return s.state === 'active';
  }
  const last = await c.client.getLastBlock();
  const acc  = await c.client.getAccount(last.last.seqno, addr);
  return acc.account.state.type === 'active';
}

function fail(msg: string): never {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mnemonic = (process.env.WALLET_MNEMONIC || '').trim();
  if (!mnemonic) {
    fail(
      'WALLET_MNEMONIC env var is required.\n' +
      '  Run:\n' +
      '    WALLET_MNEMONIC="word word ... word" npm run deploy:standalone',
    );
  }
  const words = mnemonic.split(/\s+/).filter(Boolean);
  if (words.length !== 24) fail(`WALLET_MNEMONIC must be 24 words (got ${words.length})`);

  const cnx = await connect();

  // Wallet
  const keys = await mnemonicToPrivateKey(words);
  const walletContract = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey });
  const wallet = cnx.client.open(walletContract);
  const owner = wallet.address;

  // Escrow init
  const houseWallet = process.env.HOUSE_WALLET
    ? Address.parse(process.env.HOUSE_WALLET) : owner;
  const ladaJettonWallet = process.env.LADA_JETTON_WALLET
    ? Address.parse(process.env.LADA_JETTON_WALLET) : owner;
  const escrow = await LadaEscrow.fromInit(owner, houseWallet, ladaJettonWallet);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow standalone deploy');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Endpoint:        ', cnx.endpoint, `(${cnx.kind})`);
  console.log('  Deployer (owner):', owner.toString());
  console.log('  House wallet:    ', houseWallet.toString());
  console.log('  Jetton wallet:   ', ladaJettonWallet.toString(),
              process.env.LADA_JETTON_WALLET ? '' : '(placeholder — redeploy with real value)');
  console.log('  Predicted addr:  ', escrow.address.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Balance check
  const balance = await getBalance(cnx, owner);
  console.log('  Deployer balance:', Number(balance) / 1e9, 'TON');
  if (balance < toNano('0.2')) {
    fail(
      'Deployer wallet has insufficient TON for gas + storage.\n' +
      '  Testnet faucet: https://t.me/testgiver_ton_bot',
    );
  }

  // Send deploy: internal msg with StateInit + Tact Deploy body
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
        init: escrow.init,
        bounce: false,
        // @stdlib/deploy Deploy message: op=0x946a98b6, queryId (uint64)
        body: beginCell().storeUint(0x946a98b6, 32).storeUint(0n, 64).endCell(),
      }),
    ],
  });

  // Wait for our wallet's seqno to advance (= broadcast accepted)
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    if ((await wallet.getSeqno()) > seqno) break;
  }

  // Then poll the contract until it's active on-chain
  console.log('  Waiting for contract to become active on-chain…');
  let activated = false;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (await isActive(cnx, escrow.address)) { activated = true; break; }
  }
  if (!activated) fail('Timed out waiting for contract to activate. Check tx on tonviewer.');

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

main().catch((e) => { console.error(e); process.exit(1); });
