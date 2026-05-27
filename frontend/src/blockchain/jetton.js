/**
 * Lada jetton helpers.
 *
 * Balance lookup uses a two-step on-chain get-method chain (same approach as
 * the backend indexer):
 *   1. jetton master  . get_wallet_address(owner) → jetton wallet address
 *   2. jetton wallet  . get_wallet_data()         → [balance, ...]
 *
 * Primary: Toncenter v2 runGetMethod.  Fallback: TonAPI v2 REST.
 */
import { Address, beginCell, Cell, toNano } from '@ton/core';

const JETTON_TRANSFER_OP = 0x0f8a7ea5;

const NETWORK = import.meta.env.VITE_TON_NETWORK || 'mainnet';
const TONCENTER_BASE = NETWORK === 'mainnet'
  ? 'https://toncenter.com/api/v2'
  : 'https://testnet.toncenter.com/api/v2';
const TONAPI_BASE = NETWORK === 'mainnet'
  ? 'https://tonapi.io'
  : 'https://testnet.tonapi.io';

// Env vars take precedence; hardcoded values are the deployed contract addresses.
const LADA_MASTER    = import.meta.env.VITE_LADA_JETTON_MASTER
  || 'EQBjNisz_m-sdA9TcosQMmugdhl6hDjGcCMgQFa85p_8jx7p';
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS
  || 'EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ';

// ─── Toncenter helpers ────────────────────────────────────────────────────────

async function runGetMethod(address, method, stack = []) {
  const res = await fetch(`${TONCENTER_BASE}/runGetMethod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, method, stack }),
  });
  return res.json();  // { ok, result: { stack, exit_code, ... } }
}

/**
 * Resolve the jetton wallet address for `owner` using Toncenter get_wallet_address.
 * Returns an Address object.
 */
async function resolveJettonWalletAddr(owner) {
  const ownerBoc = beginCell()
    .storeAddress(Address.parse(owner))
    .endCell()
    .toBoc()
    .toString('base64');

  console.log('[jetton] get_wallet_address — master:', LADA_MASTER, '| owner:', owner);
  const r = await runGetMethod(LADA_MASTER, 'get_wallet_address', [
    ['slice', { bytes: ownerBoc }],
  ]);
  console.log('[jetton] get_wallet_address raw response:', JSON.stringify(r).slice(0, 300));

  if (!r.ok) throw new Error(`Toncenter get_wallet_address: ok=false — ${r.error}`);
  if (r.result?.exit_code !== 0) throw new Error(`get_wallet_address exit_code=${r.result?.exit_code}`);

  const entry  = r.result.stack?.[0];
  const cellB64 = entry?.[1]?.bytes ?? (typeof entry?.[1] === 'string' ? entry[1] : null);
  if (!cellB64) throw new Error('get_wallet_address: no cell in stack — ' + JSON.stringify(entry));

  const addr = Cell.fromBase64(cellB64).beginParse().loadAddress();
  console.log('[jetton] resolved jetton wallet:', addr.toString());
  return addr;
}

// ─── On-chain confirmation polling ───────────────────────────────────────────

/**
 * Returns the LT (logical time) of the most recent transaction on the escrow
 * contract. Used as a baseline before sending so we can detect the new tx.
 */
export async function getEscrowLatestLt() {
  try {
    const res  = await fetch(
      `${TONCENTER_BASE}/getTransactions?${new URLSearchParams({ address: ESCROW_ADDRESS, limit: '1' })}`,
    );
    const data = await res.json();
    const lt   = data.result?.[0]?.transaction_id?.lt ?? '0';
    console.log('[jetton] escrow baseline LT:', lt);
    return lt;
  } catch (e) {
    console.warn('[jetton] getEscrowLatestLt failed:', e.message);
    return '0';
  }
}

/**
 * Poll the escrow contract until a transaction with LT > preLt appears.
 * Returns true when confirmed, false on timeout.
 */
export async function waitForEscrowDeposit(preLt, { timeoutMs = 30_000, pollMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const baseline = BigInt(preLt || '0');
  console.log('[jetton] polling escrow for deposit confirmation, baseline LT:', preLt);

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    try {
      const res  = await fetch(
        `${TONCENTER_BASE}/getTransactions?${new URLSearchParams({ address: ESCROW_ADDRESS, limit: '3' })}`,
      );
      const data = await res.json();
      const txs  = Array.isArray(data.result) ? data.result : [];
      const latestLt = txs[0]?.transaction_id?.lt;
      console.log('[jetton] escrow LT now:', latestLt, '| need >', baseline.toString());
      if (latestLt && BigInt(latestLt) > baseline) {
        console.log('[jetton] deposit confirmed on-chain!');
        return true;
      }
    } catch (e) {
      console.warn('[jetton] escrow poll error:', e.message);
    }
  }
  console.warn('[jetton] deposit confirmation timed out after', timeoutMs, 'ms');
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the user's jetton wallet address string, or null if none. */
export async function getUserJettonWallet(owner) {
  try {
    const addr = await resolveJettonWalletAddr(owner);
    return addr.toString();
  } catch (e) {
    console.warn('[jetton] getUserJettonWallet failed:', e.message);
    // Fallback: TonAPI
    const url = `${TONAPI_BASE}/v2/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(LADA_MASTER)}`;
    console.log('[jetton] TonAPI wallet lookup fallback:', url);
    const res  = await fetch(url);
    const data = await res.json();
    console.log('[jetton] TonAPI wallet response:', JSON.stringify(data).slice(0, 200));
    return data.wallet_address?.address ?? data.jetton_wallet_address ?? null;
  }
}

/**
 * Returns the user's LADA balance as a BigInt of nano-LADA (9 decimals).
 * Tries Toncenter get_wallet_address → get_wallet_data first;
 * falls back to TonAPI v2 REST if anything fails.
 */
export async function getLadaBalance(owner) {
  if (!owner) return 0n;
  try {
    return await getLadaBalanceToncenter(owner);
  } catch (e) {
    console.warn('[jetton] Toncenter balance failed, trying TonAPI fallback:', e.message);
    return getLadaBalanceTonAPI(owner);
  }
}

async function getLadaBalanceToncenter(owner) {
  // Step 1: resolve jetton wallet
  const walletAddr = await resolveJettonWalletAddr(owner);
  const walletStr  = walletAddr.toString();

  // Step 2: get_wallet_data → stack[0] is balance (num)
  console.log('[jetton] get_wallet_data — wallet:', walletStr);
  const r = await runGetMethod(walletStr, 'get_wallet_data', []);
  console.log('[jetton] get_wallet_data raw response:', JSON.stringify(r).slice(0, 300));

  if (!r.ok) throw new Error(`Toncenter get_wallet_data: ok=false — ${r.error}`);
  // exit_code -13 = account uninitialised (no tokens yet) → balance is 0
  if (r.result?.exit_code === -13 || r.result?.exit_code === 13) {
    console.log('[jetton] jetton wallet uninitialised — balance is 0');
    return 0n;
  }
  if (r.result?.exit_code !== 0) throw new Error(`get_wallet_data exit_code=${r.result?.exit_code}`);

  const balEntry = r.result.stack?.[0];
  console.log('[jetton] balance stack entry:', balEntry);
  if (!balEntry || balEntry[0] !== 'num') throw new Error('Unexpected balance stack type: ' + JSON.stringify(balEntry));

  const nano = BigInt(balEntry[1]);
  console.log('[jetton] balance (nano-LADA):', nano.toString(), '| LADA:', Number(nano / 1_000_000_000n));
  return nano;
}

async function getLadaBalanceTonAPI(owner) {
  const url = `${TONAPI_BASE}/v2/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(LADA_MASTER)}`;
  console.log('[jetton] TonAPI balance fetch:', url);
  try {
    const res  = await fetch(url);
    const data = await res.json();
    console.log('[jetton] TonAPI balance response:', JSON.stringify(data).slice(0, 300));
    if (!res.ok) {
      console.warn('[jetton] TonAPI balance error:', data);
      return 0n;
    }
    const nano = BigInt(data.balance ?? '0');
    console.log('[jetton] TonAPI balance (nano-LADA):', nano.toString(), '| LADA:', Number(nano / 1_000_000_000n));
    return nano;
  } catch (e) {
    console.error('[jetton] TonAPI balance fetch threw:', e.message);
    return 0n;
  }
}

/**
 * Build the TonConnect tx for depositing `amount` nano-LADA into the escrow.
 *
 * The contract's TokenNotification handler reads `forwardPayload: Slice as remaining`
 * and expects the first 64 bits to be the uint64 raceId — no Either-discriminant
 * prefix.  Storing the raceId inline (without storeBit/storeRef) puts exactly
 * 64 bits into the remaining slice after the jetton wallet forwards the notification.
 */
export async function buildDeposit({ owner, amount, raceIdOnChain }) {
  if (!ESCROW_ADDRESS) throw new Error('VITE_ESCROW_CONTRACT_ADDRESS not configured');
  const userJettonWallet = await getUserJettonWallet(owner);
  if (!userJettonWallet) throw new Error('You have no Lada jetton wallet yet — buy some LADA first.');

  const raceIdBigInt = BigInt(raceIdOnChain);   // on_chain_id is a string from the API

  // forward_payload: pure 64-bit raceId in a reference cell.
  // The Either discriminant bit is handled by the transfer message structure;
  // it must NOT appear inside the payload content.
  const forwardPayload = beginCell()
    .storeUint(raceIdBigInt, 64)
    .endCell();

  console.log('[jetton] buildDeposit ─────────────────────────────');
  console.log('[jetton]   owner          :', owner);
  console.log('[jetton]   amount (nano)  :', amount.toString());
  console.log('[jetton]   raceIdOnChain  :', raceIdOnChain, '→ BigInt:', raceIdBigInt.toString());
  console.log('[jetton]   ESCROW_ADDRESS :', ESCROW_ADDRESS);
  console.log('[jetton]   userJettonWallet:', userJettonWallet);
  console.log('[jetton]   forward_payload : storeUint(raceId, 64) in ref cell');

  const body = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)            // 0x0f8a7ea5
    .storeUint(0n, 64)                            // query_id
    .storeCoins(BigInt(amount))                   // jetton amount
    .storeAddress(Address.parse(ESCROW_ADDRESS))  // destination (escrow)
    .storeAddress(Address.parse(owner))           // response_destination
    .storeBit(0)                                  // custom_payload = null
    .storeCoins(toNano('0.05'))                   // forward_ton_amount
    .storeRef(forwardPayload)                     // forward_payload as reference cell
    .endCell();

  const bocBase64 = body.toBoc().toString('base64');
  console.log('[jetton]   body BOC (base64):', bocBase64.slice(0, 60), '…');

  return {
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [{
      address: userJettonWallet,
      amount: toNano('0.1').toString(),
      payload: bocBase64,
    }],
  };
}
