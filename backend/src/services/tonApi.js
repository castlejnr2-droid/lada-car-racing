/**
 * Minimal TonAPI client. We use TonAPI rather than running our own node
 * because it gives us:
 *   - parsed account state (jetton balances)
 *   - transaction streams with already-decoded internal messages
 *
 * This module wraps just what the backend needs. Anything more exotic
 * (raw cells, light client) belongs in the indexer worker, not here.
 */
import { config, tonApiBase } from '../config.js';

async function tonApiFetch(path, opts = {}) {
  const url = `${tonApiBase()}${path}`;
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (config.ton.apiKey) headers.Authorization = `Bearer ${config.ton.apiKey}`;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TonAPI ${path} → ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Returns the Lada jetton balance for `ownerAddress`, in nano-LADA, as a BigInt.
 * Returns 0n if the owner has no jetton wallet yet.
 */
export async function getJettonBalance(ownerAddress, jettonMasterAddress) {
  try {
    const data = await tonApiFetch(
      `/v2/accounts/${encodeURIComponent(ownerAddress)}/jettons/${encodeURIComponent(jettonMasterAddress)}`,
    );
    return BigInt(data.balance ?? '0');
  } catch (e) {
    // 404 ≈ wallet doesn't exist yet ≈ zero balance
    if (/→ 404/.test(e.message)) return 0n;
    throw e;
  }
}

/**
 * Returns the most recent N transactions for an account, newest first.
 * Used by the indexer to find new contract events.
 */
export async function getAccountTransactions(account, { limit = 50, beforeLt } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (beforeLt) qs.set('before_lt', String(beforeLt));
  const data = await tonApiFetch(
    `/v2/blockchain/accounts/${encodeURIComponent(account)}/transactions?${qs}`,
  );
  return data.transactions || [];
}
