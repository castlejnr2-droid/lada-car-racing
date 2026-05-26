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
 * Build the TonConnect tx for depositing `amount` nano-LADA into the escrow,
 * with `raceIdOnChain` encoded in the forward payload so the contract
 * credits the deposit to the right race.
 */
export async function buildDeposit({ owner, amount, raceIdOnChain }) {
  if (!ESCROW_ADDRESS) throw new Error('VITE_ESCROW_CONTRACT_ADDRESS not configured');
  const userJettonWallet = await getUserJettonWallet(owner);
  if (!userJettonWallet) throw new Error('You have no Lada jetton wallet yet — buy some LADA first.');

  const forwardPayload = beginCell().storeUint(BigInt(raceIdOnChain), 64).endCell();

  const body = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(0n, 64)                                        // query id
    .storeCoins(BigInt(amount))
    .storeAddress(Address.parse(ESCROW_ADDRESS))              // destination
    .storeAddress(Address.parse(owner))                       // response_destination
    .storeBit(0)                                              // no custom_payload
    .storeCoins(toNano('0.05'))                               // forward_ton_amount
    .storeBit(1)                                              // forward_payload as ref
    .storeRef(forwardPayload)
    .endCell();

  return {
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [{
      address: userJettonWallet,
      amount: toNano('0.1').toString(),
      payload: body.toBoc().toString('base64'),
    }],
  };
}

/**
 * Build a jetton deposit tx at lobby-creation time.
 * Uses a text comment forward-payload carrying the lobby ID so the
 * escrow contract (and the indexer) can identify which lobby this funds.
 */
export async function buildLobbyDeposit({ owner, amount, lobbyId }) {
  const userJettonWallet = await getUserJettonWallet(owner);
  if (!userJettonWallet) throw new Error('You have no Lada jetton wallet yet — buy some LADA first.');

  // TEP-74 text-comment forward payload (op 0x00000000 + UTF-8 string)
  const forwardPayload = beginCell()
    .storeUint(0, 32)
    .storeStringTail(String(lobbyId))
    .endCell();

  const body = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(0n, 64)                                        // query id
    .storeCoins(BigInt(amount))
    .storeAddress(Address.parse(ESCROW_ADDRESS))              // destination
    .storeAddress(Address.parse(owner))                       // response_destination
    .storeBit(0)                                              // no custom_payload
    .storeCoins(toNano('0.05'))                               // forward_ton_amount
    .storeBit(1)                                              // forward_payload as ref
    .storeRef(forwardPayload)
    .endCell();

  return {
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [{
      address: userJettonWallet,
      amount: toNano('0.1').toString(),
      payload: body.toBoc().toString('base64'),
    }],
  };
}
