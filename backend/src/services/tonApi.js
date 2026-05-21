/**
 * Toncenter HTTP API v2 client.
 *
 * Switched from TonAPI to Toncenter because we're issued a Toncenter API
 * key. Same exports, same call-sites — only the wire protocol changed.
 *
 *   mainnet base : https://toncenter.com/api/v2
 *   testnet base : https://testnet.toncenter.com/api/v2
 *   auth header  : X-API-Key: $TONCENTER_API_KEY
 */
import { Address, beginCell, Cell } from '@ton/core';
import { config } from '../config.js';

const TONCENTER = {
  mainnet: 'https://toncenter.com/api/v2',
  testnet: 'https://testnet.toncenter.com/api/v2',
};

function baseUrl() {
  return TONCENTER[config.ton.network] || TONCENTER.testnet;
}

async function toncenterFetch(path, opts = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (config.ton.apiKey) headers['X-API-Key'] = config.ton.apiKey;
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok || (data && data.ok === false)) {
    const detail = data?.error || data?.result || text;
    throw new Error(`Toncenter ${path} → ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data?.result;
}

/** Toncenter runGetMethod: returns the result envelope (stack, gas_used, exit_code). */
async function runGetMethod(address, method, stack = []) {
  return toncenterFetch('/runGetMethod', {
    method: 'POST',
    body: JSON.stringify({ address, method, stack }),
  });
}

/**
 * Returns the Lada jetton balance for `ownerAddress`, in nano-LADA, as a BigInt.
 * Returns 0n if the owner has no jetton wallet yet, or if any get-method fails
 * (which the indexer treats as "nothing to see, try again later").
 *
 * Implementation: Toncenter doesn't have a single jetton-balance endpoint
 * like TonAPI did, so we chain two get-methods:
 *   1. jetton master . get_wallet_address(owner) → jetton wallet address
 *   2. jetton wallet . get_wallet_data()         → (balance, ...)
 */
export async function getJettonBalance(ownerAddress, jettonMasterAddress) {
  try {
    const ownerSliceBoc = beginCell()
      .storeAddress(Address.parse(ownerAddress))
      .endCell()
      .toBoc()
      .toString('base64');

    const walletAddrResult = await runGetMethod(jettonMasterAddress, 'get_wallet_address', [
      ['slice', { bytes: ownerSliceBoc }],
    ]);
    if (walletAddrResult?.exit_code !== 0 && walletAddrResult?.exit_code !== undefined) return 0n;

    const walletCellEntry = walletAddrResult?.stack?.[0];
    const walletCellB64 =
      walletCellEntry?.[1]?.bytes
      || (typeof walletCellEntry?.[1] === 'string' ? walletCellEntry[1] : null);
    if (!walletCellB64) return 0n;

    const walletAddr = Cell.fromBase64(walletCellB64).beginParse().loadAddress();

    const dataResult = await runGetMethod(walletAddr.toString(), 'get_wallet_data', []);
    if (dataResult?.exit_code !== 0 && dataResult?.exit_code !== undefined) return 0n;

    const balanceEntry = dataResult?.stack?.[0];
    if (!balanceEntry || balanceEntry[0] !== 'num') return 0n;
    return BigInt(balanceEntry[1]);
  } catch (e) {
    // Jetton wallet doesn't exist yet, or get-method exited non-zero → 0n
    if (/exit_code|uninitialized|inactive|not\s*found/i.test(e.message)) return 0n;
    throw e;
  }
}

/**
 * Returns the most recent N transactions for an account, newest first.
 * Toncenter response shape:
 *   [{ utime, transaction_id: { hash, lt }, in_msg, out_msgs, ... }]
 */
export async function getAccountTransactions(account, { limit = 50, beforeLt, beforeHash } = {}) {
  const qs = new URLSearchParams({ address: account, limit: String(limit) });
  if (beforeLt)   qs.set('lt',   String(beforeLt));
  if (beforeHash) qs.set('hash', beforeHash);
  const txs = await toncenterFetch(`/getTransactions?${qs}`);
  return Array.isArray(txs) ? txs : [];
}

/**
 * Extract the 32-bit op-code from a Toncenter inbound/outbound message.
 * Toncenter doesn't decode it for us; the body comes back as base64 BOC in
 * `msg.msg_data.body`. We parse the first 32 bits of the cell as the op.
 */
export function opCodeFrom(msg) {
  const bodyB64 = msg?.msg_data?.body || msg?.body;
  if (!bodyB64) return null;
  try {
    const cell = Cell.fromBase64(bodyB64);
    const s = cell.beginParse();
    if (s.remainingBits < 32) return null;
    return s.loadUint(32);
  } catch {
    return null;
  }
}
