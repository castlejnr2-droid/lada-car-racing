/**
 * One-off: recover stuck LADA from new escrow via WithdrawJettons.
 *
 * Background: the race entry no longer exists in the contract map, so
 * the Refund op fails with "Unknown race". WithdrawJettons bypasses
 * the race map and directly transfers any held LADA to a given address.
 *
 * Usage: node src/scripts/refundRace.js <amountNano> <toAddress>
 * Example: node src/scripts/refundRace.js 5000000000 UQBTxxxxxxx
 */
import 'dotenv/config';
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient4, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

const OP_WITHDRAW_JETTONS = 0x6c726306;

const amountNano = process.argv[2];
const toAddressStr = process.argv[3];

if (!amountNano || !toAddressStr) {
  console.error('Usage: node src/scripts/refundRace.js <amountNano> <toAddress>');
  console.error('Example: node src/scripts/refundRace.js 5000000000 UQBTxxxxxxx');
  process.exit(1);
}

const escrow  = process.env.ESCROW_CONTRACT_ADDRESS;
const mnemonic = process.env.HOUSE_WALLET_MNEMONIC?.trim().split(/\s+/);
const network  = process.env.TON_NETWORK || 'mainnet';

if (!escrow)   { console.error('ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!mnemonic || mnemonic.length !== 24) { console.error('HOUSE_WALLET_MNEMONIC not set / wrong length'); process.exit(1); }

const endpoint = network === 'mainnet'
  ? 'https://mainnet-v4.tonhubapi.com'
  : 'https://testnet-v4.tonhubapi.com';

const keyPair  = await mnemonicToPrivateKey(mnemonic);
const wallet   = WalletContractV5R1.create({ publicKey: keyPair.publicKey, workchain: 0 });
const client   = new TonClient4({ endpoint });
const contract = client.open(wallet);

const amountBigInt = BigInt(amountNano);
const escrowAddr   = Address.parse(escrow);
const toAddr       = Address.parse(toAddressStr);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  WithdrawJettons op');
console.log('  Network :', network);
console.log('  Escrow  :', escrow);
console.log('  Amount  :', amountBigInt.toString(), 'nano');
console.log('  To      :', toAddr.toString({ urlSafe: true, bounceable: false }));
console.log('  Wallet  :', wallet.address.toString({ urlSafe: true, bounceable: false }));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const body = beginCell()
  .storeUint(OP_WITHDRAW_JETTONS, 32)
  .storeCoins(amountBigInt)
  .storeAddress(toAddr)
  .endCell();

// 0.3 TON: escrow's sendJetton uses JETTON_FORWARD_TON=0.2 + compute gas
const seqno = await contract.getSeqno();
console.log('seqno:', seqno);

await contract.sendTransfer({
  seqno,
  secretKey: keyPair.secretKey,
  messages: [internal({
    to:     escrowAddr,
    value:  toNano('0.3'),
    bounce: true,
    body,
  })],
});
console.log('WithdrawJettons tx sent. Polling for seqno confirmation…');

const deadline = Date.now() + 60_000;
let confirmed = false;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 3000));
  const newSeqno = await contract.getSeqno().catch(() => seqno);
  if (newSeqno > seqno) {
    console.log(`✓ Confirmed  seqno ${seqno} → ${newSeqno}`);
    confirmed = true;
    break;
  }
  process.stdout.write('.');
}
if (!confirmed) console.warn('\n⚠ Timed out waiting for seqno advance — tx may still confirm');

console.log('\nDone. Check tonviewer for outbound jetton transfer from escrow:');
console.log(`  https://tonviewer.com/${escrow}`);
