/**
 * On-chain → backend indexer (Toncenter v2 edition).
 *
 * Polls the escrow contract for new transactions and dispatches typed events:
 *
 *   incoming TokenNotification (0x7362d09c) → Deposit
 *   incoming CommitHash        (0x6c726301) → Commit
 *   incoming RevealSecret      (0x6c726302) → Reveal
 *   outgoing WinnerDeclared    (0x6c7263f1) → WinnerDeclared
 *   outgoing RaceRefunded      (0x6c7263f2) → RaceRefunded
 *
 * Op-codes are parsed from each message's base64 BOC body (Toncenter doesn't
 * decode them for us). Handlers in services/events.js are idempotent on
 * (tx_hash, type) so duplicate deliveries are safe.
 */
import { Address } from '@ton/core';
import { config } from '../config.js';
import { getAccountTransactions, opCodeFrom } from './tonApi.js';
import { handlers } from './events.js';
import { query } from '../db/pool.js';

const OP = {
  TokenNotification: 0x7362d09c,
  CommitHash:        0x6c726301,
  RevealSecret:      0x6c726302,
  WinnerDeclared:    0x6c7263f1,
  RaceRefunded:      0x6c7263f2,
};

let lastSeenLt = null;
let running = false;

export async function startIndexer() {
  if (!config.ton.escrowAddress) {
    console.warn('[indexer] ESCROW_CONTRACT_ADDRESS not set — indexer disabled');
    return;
  }
  try {
    Address.parse(config.ton.escrowAddress);
  } catch {
    console.warn('[indexer] ESCROW_CONTRACT_ADDRESS is invalid — indexer disabled:', config.ton.escrowAddress);
    return;
  }
  console.log('[indexer] watching', config.ton.escrowAddress);

  const { rows } = await query(
    `SELECT MAX(lt)::text AS lt FROM transactions WHERE lt IS NOT NULL`,
  );
  lastSeenLt = rows[0]?.lt ?? null;

  setInterval(pollOnce, config.indexer.pollMs);
}

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const txs = await getAccountTransactions(config.ton.escrowAddress, { limit: 50 });
    // Toncenter returns newest first; process chronologically.
    const ordered = txs.slice().reverse();
    for (const tx of ordered) {
      const ltStr = tx.transaction_id?.lt ?? tx.lt;
      if (!ltStr) continue;
      if (lastSeenLt && BigInt(ltStr) <= BigInt(lastSeenLt)) continue;
      try {
        await processTx(tx);
      } catch (e) {
        console.error('[indexer] failed tx', tx.transaction_id?.hash, e);
        return;       // don't advance lastSeenLt — retry next poll
      }
      lastSeenLt = ltStr;
    }
  } catch (e) {
    console.error('[indexer] poll error', e);
  } finally {
    running = false;
  }
}

async function processTx(tx) {
  const hash = tx.transaction_id?.hash || tx.hash;
  const lt   = tx.transaction_id?.lt   || tx.lt;

  // Inbound op
  if (tx.in_msg) {
    const opIn = opCodeFrom(tx.in_msg);
    if (opIn === OP.TokenNotification) {
      // TODO: decode forwardPayload from in_msg body to extract raceId/amount/from
      return handlers.Deposit({
        txHash: hash, lt,
        raceId: null,
        from:   tx.in_msg?.source,
        amount: tx.in_msg?.value,
      });
    }
    if (opIn === OP.CommitHash) {
      return handlers.Commit({ txHash: hash, lt, raceId: null, player: tx.in_msg?.source });
    }
    if (opIn === OP.RevealSecret) {
      return handlers.Reveal({ txHash: hash, lt, raceId: null, player: tx.in_msg?.source });
    }
  }

  // Outbound ops (events emitted by the contract)
  for (const outMsg of tx.out_msgs || []) {
    const opOut = opCodeFrom(outMsg);
    if (opOut === OP.WinnerDeclared) {
      // TODO: parse winner/loser/combinedSeed/payout/houseFee from outMsg body
      return handlers.WinnerDeclared({ txHash: hash, lt });
    }
    if (opOut === OP.RaceRefunded) {
      return handlers.RaceRefunded({ txHash: hash, lt });
    }
  }
}
