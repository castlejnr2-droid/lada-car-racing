/**
 * One-shot fund recovery for all deployed LadaEscrow contracts.
 *
 * For each escrow:
 *   1. Checks TON balance and LADA balance (via the escrow's configured jetton wallet).
 *   2. Calls WithdrawJettons (0x6c726306) to drain all LADA to the house wallet.
 *      Waits for on-chain confirmation before proceeding.
 *   3. Calls "withdrawTon" (text op) to drain all remaining TON to the contract owner.
 *
 * Withdrawal order matters: WithdrawJettons first because it needs ~0.1 TON inside
 * the escrow to fund the outbound jetton transfer gas.  withdrawTon drains what's
 * left afterward.
 *
 * The script auto-detects whether the house wallet was deployed as WalletV4 or V5R1
 * by comparing derived addresses against the escrow's owner() getter result.
 *
 * Run from the backend/ directory:
 *   node src/scripts/recoverFunds.js
 *
 * Required env vars:
 *   HOUSE_WALLET_MNEMONIC     24-word seed of the contract owner/house wallet
 *   TONCENTER_API_KEY         optional but strongly recommended on mainnet
 */

import 'dotenv/config';
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

// ─── Contracts to drain ───────────────────────────────────────────────────────
// Verified from git history + user-provided balances.
// EQCXEgtnCZDaWu500BCxugvrElPD7kJQWYaNc6X3UEP_EIzn is not in git history
// (post-deploy, recent) — added from user confirmation.
// EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ is the original deployment
// referenced in all early .env commits.
// No other escrow addresses were found in the full git history.
const ESCROW_CONTRACTS = [
  {
    address: 'EQCXEgtnCZDaWu500BCxugvrElPD7kJQWYaNc6X3UEP_EIzn',
    label:   'active escrow (~209 LADA + 3.34 TON)',
  },
  {
    address: 'EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ',
    label:   'original deployment',
  },
];

// LadaEscrow op codes
const OP_WITHDRAW_JETTONS = 0x6c726306;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry an async fn up to `attempts` times on HTTP 429, with exponential backoff. */
async function withRetry(fn, attempts = 5, baseDelayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const is429 = e?.message?.includes('429') || e?.response?.status === 429 || e?.status === 429;
      if (!is429 || i === attempts - 1) throw e;
      const delay = baseDelayMs * 2 ** i;
      console.log(`    [retry ${i + 1}/${attempts}] 429 rate-limit — waiting ${delay / 1000}s…`);
      await sleep(delay);
    }
  }
}

// ─── Address helpers ──────────────────────────────────────────────────────────

/**
 * Extract an Address from a raw stack item (outer TonClient parseStackItem result).
 * Toncenter v2 returns address/slice getter results as { type:'cell', cell:Cell }
 * (not 'slice' as one might expect) — handle both.
 */
function stackItemToAddress(item) {
  if (!item) return null;
  // type:'cell' or type:'slice' — both carry a .cell property with the data
  if ((item.type === 'slice' || item.type === 'cell') && item.cell) {
    return item.cell.beginParse().loadAddress();
  }
  // Raw Cell fallback
  if (typeof item.beginParse === 'function') return item.beginParse().loadAddress();
  return null;
}

/** Extract a BigInt from a raw stack item (outer parseStackItem result). */
function stackItemToBigInt(item) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'bigint') return item;
  if (item.type === 'int') return item.value;
  return null;
}

// ─── Send + confirm ───────────────────────────────────────────────────────────

async function sendAndWait(contract, keyPair, to, body, tonValue, label) {
  const seqno = await withRetry(() => contract.getSeqno());
  console.log(`    [${label}] seqno=${seqno}  value=${tonValue} TON  to=${to.toString({ urlSafe: true, bounceable: true })}`);

  await sleep(2000); // brief pause so rate limiter recovers before send
  await withRetry(() => contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to,
        value:  toNano(tonValue),
        bounce: true,
        body,
      }),
    ],
  }));
  console.log(`    [${label}] tx sent — polling for confirmation (up to 30 s)…`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    try {
      const newSeqno = await withRetry(() => contract.getSeqno());
      if (newSeqno > seqno) {
        console.log(`    [${label}] confirmed  seqno ${seqno} → ${newSeqno}`);
        await sleep(5_000); // give escrow one extra block to process the inbound message
        return true;
      }
    } catch {
      // ignore transient errors during polling
    }
  }
  console.warn(`    [${label}] ⚠ confirmation timed out after 30 s — proceeding anyway`);
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  recoverFunds — drain all deployed LadaEscrow contracts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Load mnemonic ──────────────────────────────────────────────────────────
  const mnemonic = (process.env.HOUSE_WALLET_MNEMONIC || '').trim();
  if (!mnemonic) {
    console.error('✗ HOUSE_WALLET_MNEMONIC is not set');
    process.exit(1);
  }
  const words = mnemonic.split(/\s+/);
  if (words.length !== 24) {
    console.error(`✗ HOUSE_WALLET_MNEMONIC has ${words.length} words — expected 24`);
    process.exit(1);
  }

  // ── TonClient ─────────────────────────────────────────────────────────────
  const apiKey = process.env.TONCENTER_API_KEY || undefined;
  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey,
  });
  console.log(`  Endpoint: toncenter mainnet v2${apiKey ? ' (API key set)' : ' (no API key)'}`)

  // ── Derive both wallet versions from the same mnemonic ────────────────────
  // The deploy script used WalletContractV4; the backend uses V5R1.
  // We detect which one is the actual contract owner below.
  const keyPair = await mnemonicToPrivateKey(words);
  const walletV4  = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const walletV5  = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
  const addrV4Raw = walletV4.address.toRawString();
  const addrV5Raw = walletV5.address.toRawString();

  console.log(`  Wallet V4   : ${walletV4.address.toString({ urlSafe: true, bounceable: false })}`);
  console.log(`  Wallet V5R1 : ${walletV5.address.toString({ urlSafe: true, bounceable: false })}`);
  console.log('');

  // ── Process each escrow ────────────────────────────────────────────────────
  for (const { address, label } of ESCROW_CONTRACTS) {
    console.log(`${'─'.repeat(62)}`);
    console.log(`  Escrow : ${address}`);
    console.log(`  Label  : ${label}`);
    console.log('');

    const escrowAddr = Address.parse(address);

    // 1. Check contract is active ─────────────────────────────────────────────
    let contractState;
    try {
      contractState = await withRetry(() => client.getContractState(escrowAddr));
    } catch (e) {
      console.log(`  ✗ getContractState failed: ${e.message} — skipping`);
      continue;
    }
    if (contractState.state !== 'active') {
      console.log(`  ⚠ Contract is "${contractState.state}" (not active) — skipping`);
      continue;
    }
    await sleep(1000);

    // 2. TON balance ──────────────────────────────────────────────────────────
    const tonBalance = await withRetry(() => client.getBalance(escrowAddr));
    console.log(`  TON balance : ${Number(tonBalance) / 1e9} TON`);
    await sleep(1000);

    // 3. Detect owner and choose signer wallet ────────────────────────────────
    let ownerAddr = null;
    try {
      const r = await withRetry(() => client.runMethod(escrowAddr, 'owner', []));
      const raw = r.stack.items[0];
      console.log(`  owner() raw item: ${JSON.stringify(raw, (k, v) => typeof v === 'bigint' ? v.toString() : v)?.slice(0, 120)}`);
      ownerAddr = stackItemToAddress(raw);
      // Fallback: try TupleReader.readAddress() directly
      if (!ownerAddr) {
        try { ownerAddr = r.stack.readAddress(); } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn(`  ⚠ owner() getter failed: ${e.message}`);
    }
    if (ownerAddr) {
      console.log(`  Owner       : ${ownerAddr.toString({ urlSafe: true, bounceable: false })}`);
    }
    await sleep(1000);

    let signerContract;
    if (ownerAddr?.toRawString() === addrV4Raw) {
      signerContract = client.open(walletV4);
      console.log(`  Signer      : WalletV4`);
    } else if (ownerAddr?.toRawString() === addrV5Raw) {
      signerContract = client.open(walletV5);
      console.log(`  Signer      : WalletV5R1`);
    } else {
      console.error(`  ✗ Neither V4 (${walletV4.address.toString({ urlSafe:true, bounceable:false })}) nor V5R1 (${walletV5.address.toString({ urlSafe:true, bounceable:false })}) matches owner — cannot sign`);
      continue;
    }

    // 4. Get escrow's configured LADA jetton wallet ───────────────────────────
    let escrowJettonWallet = null;
    try {
      const r = await withRetry(() => client.runMethod(escrowAddr, 'jettonWalletAddress', []));
      escrowJettonWallet = stackItemToAddress(r.stack.items[0]);
    } catch (e) {
      console.warn(`  ⚠ jettonWalletAddress() getter failed: ${e.message}`);
    }
    if (escrowJettonWallet) {
      console.log(`  LADA wallet : ${escrowJettonWallet.toString({ urlSafe: true, bounceable: true })}`);
    }
    await sleep(1000);

    // 5. LADA balance ─────────────────────────────────────────────────────────
    let ladaBalance = 0n;
    if (escrowJettonWallet) {
      try {
        const r = await withRetry(() => client.runMethod(escrowJettonWallet, 'get_wallet_data', []));
        // Standard jetton wallet: first stack item is balance (int)
        const balItem = r.stack.items[0];
        ladaBalance = stackItemToBigInt(balItem) ?? 0n;
        console.log(`  LADA balance: ${Number(ladaBalance) / 1e9} LADA  (${ladaBalance} nano-LADA)`);
      } catch (e) {
        // exit_code -13 / 13 = wallet uninitialised → no LADA
        if (e.message?.includes('13') || e.message?.includes('uninit')) {
          console.log(`  LADA balance: 0 LADA (jetton wallet uninitialised)`);
        } else {
          console.warn(`  ⚠ get_wallet_data failed: ${e.message}`);
        }
      }
    }
    await sleep(1000);
    console.log('');

    if (ladaBalance === 0n && tonBalance < toNano('0.01')) {
      console.log('  Nothing to recover — skipping.\n');
      continue;
    }

    // 6. Determine LADA recovery destination ──────────────────────────────────
    // Prefer the configured houseWallet from the escrow; fall back to owner.
    let ladaDestination = ownerAddr ?? signerContract.address;
    try {
      const r = await withRetry(() => client.runMethod(escrowAddr, 'houseWalletAddress', []));
      const hw = stackItemToAddress(r.stack.items[0]);
      if (hw) { ladaDestination = hw; }
    } catch {
      // use fallback silently
    }
    await sleep(1000);
    console.log(`  LADA → ${ladaDestination.toString({ urlSafe: true, bounceable: false })}`);
    console.log(`  TON  → ${ownerAddr?.toString({ urlSafe: true, bounceable: false }) ?? '(owner)'}`);
    console.log('');

    // 7. Top-up escrow gas if needed before WithdrawJettons ──────────────────
    // WithdrawJettons requires the escrow to have ~0.15 TON for the outbound
    // jetton transfer.  Re-read balance here (may differ from step 2 if this
    // is a re-run after a previous partial recovery).
    const tonBeforeWithdraw = await withRetry(() => client.getBalance(escrowAddr)).catch(() => tonBalance);
    await sleep(1000);
    if (ladaBalance > 0n && tonBeforeWithdraw < toNano('0.25')) {
      console.log(`  Step 0/2 — TopUpGas: escrow only has ${Number(tonBeforeWithdraw) / 1e9} TON — sending 0.5 TON for gas`);
      const topupBody = beginCell().endCell(); // empty body — plain TON transfer
      await sendAndWait(signerContract, keyPair, escrowAddr, topupBody, '0.5', 'TopUpGas');
      await sleep(1000);
    }

    // 7. WithdrawJettons ───────────────────────────────────────────────────────
    if (ladaBalance > 0n) {
      console.log(`  Step 1/2 — WithdrawJettons: ${Number(ladaBalance) / 1e9} LADA`);
      // 0.3 TON: escrow needs ~0.15+ for outbound jetton transfer + gas
      const body = beginCell()
        .storeUint(OP_WITHDRAW_JETTONS, 32)
        .storeCoins(ladaBalance)
        .storeAddress(ladaDestination)
        .endCell();
      await sendAndWait(signerContract, keyPair, escrowAddr, body, '0.3', 'WithdrawJettons');
    } else {
      console.log(`  Step 1/2 — WithdrawJettons: skipped (no LADA balance)`);
    }

    // 8. withdrawTon ──────────────────────────────────────────────────────────
    // The contract sends SendRemainingBalance to self.owner so we don't need
    // a 'to' in the body.  We attach a tiny amount (0.05 TON) since the
    // message itself needs some TON; the contract returns everything.
    await sleep(1000);
    const tonAfterLadaWithdraw = await withRetry(() => client.getBalance(escrowAddr)).catch(() => tonBalance);
    if (tonAfterLadaWithdraw > toNano('0.01')) {
      console.log(`  Step 2/2 — withdrawTon: ~${Number(tonAfterLadaWithdraw) / 1e9} TON`);
      // Text message: 4-byte zero prefix + ASCII text (standard TON comment encoding)
      const body = beginCell()
        .storeUint(0, 32)
        .storeStringTail('withdrawTon')
        .endCell();
      await sendAndWait(signerContract, keyPair, escrowAddr, body, '0.05', 'withdrawTon');
    } else {
      console.log(`  Step 2/2 — withdrawTon: skipped (TON balance too low to warrant drain)`);
    }

    // 9. Final balance check ──────────────────────────────────────────────────
    try {
      await sleep(5_000);
      const finalTon  = await withRetry(() => client.getBalance(escrowAddr));
      console.log(`\n  Final TON balance : ${Number(finalTon) / 1e9} TON`);
      if (escrowJettonWallet) {
        try {
          await sleep(1000);
          const r2  = await withRetry(() => client.runMethod(escrowJettonWallet, 'get_wallet_data', []));
          const bal = stackItemToBigInt(r2.stack.items[0]) ?? 0n;
          console.log(`  Final LADA balance: ${Number(bal) / 1e9} LADA`);
        } catch { /* uninit = 0 */ }
      }
    } catch { /* best-effort */ }

    console.log(`\n  ✓ Recovery complete for ${address}\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Done — all escrow contracts processed.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((e) => { console.error(e); process.exit(1); });
