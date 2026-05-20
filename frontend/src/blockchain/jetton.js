/**
 * Lada jetton helpers.
 *
 * Sending a jetton works by calling YOUR jetton wallet (not the recipient's,
 * and not the master). We look up the user's jetton wallet via TonAPI, then
 * build a TEP-74 transfer with the escrow contract as the destination and
 * the race ID in the forwardPayload.
 */
import { Address, beginCell, toNano } from '@ton/core';

const JETTON_TRANSFER_OP = 0x0f8a7ea5;
const TONAPI_BASE = import.meta.env.VITE_TON_NETWORK === 'mainnet'
  ? 'https://tonapi.io'
  : 'https://testnet.tonapi.io';

const LADA_MASTER = import.meta.env.VITE_LADA_JETTON_MASTER;
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;

/** Returns the jetton wallet address for `owner` (a TON address string). */
export async function getUserJettonWallet(owner) {
  if (!LADA_MASTER) throw new Error('VITE_LADA_JETTON_MASTER not configured');
  const url = `${TONAPI_BASE}/v2/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(LADA_MASTER)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TonAPI jetton lookup → ${res.status}`);
  const data = await res.json();
  return data.wallet_address?.address || data.jetton_wallet_address;
}

/** Returns the user's Lada balance as a BigInt of nano-LADA. */
export async function getLadaBalance(owner) {
  if (!LADA_MASTER) return 0n;
  try {
    const url = `${TONAPI_BASE}/v2/accounts/${encodeURIComponent(owner)}/jettons/${encodeURIComponent(LADA_MASTER)}`;
    const res = await fetch(url);
    if (!res.ok) return 0n;
    const data = await res.json();
    return BigInt(data.balance ?? '0');
  } catch { return 0n; }
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
