/**
 * On-chain → backend indexer.
 *
 * Polls TonAPI for new transactions on the escrow contract address and
 * parses the standard messages we care about:
 *
 *   incoming TokenNotification (0x7362d09c)  → Deposit event
 *   incoming CommitHash        (0x6c726301)  → Commit event
 *   incoming RevealSecret      (0x6c726302)  → Reveal event
 *   outgoing WinnerDeclared    (0x6c7263f1)  → WinnerDeclared event
 *   outgoing RaceRefunded      (0x6c7263f2)  → RaceRefunded event
 *
 * Parsed events are dispatched to services/events.js so the same handlers
 * run whether the source is the indexer or a manual webhook call.
 *
 * This MVP runs in-process for simplicity; in production it should be a
 * dedicated worker so polling latency doesn't block the API event loop.
 */
import { config } from '../config.js';
import { getAccountTransactions } from './tonApi.js';
import { handlers } from './events.js';
import { query } from '../db/pool.js';

// Op-codes — keep in sync with contracts/contracts/lada_escrow.tact
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
  console.log('[indexer] watching', config.ton.escrowAddress);

  // Resume from the highest LT we've already recorded
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
    // TonAPI returns newest first — reverse so we process chronologically
    const ordered = txs.slice().reverse();
    for (const tx of ordered) {
      if (lastSeenLt && BigInt(tx.lt) <= BigInt(lastSeenLt)) continue;
      try {
        await processTx(tx);
      } catch (e) {
        console.error('[indexer] failed tx', tx.hash, e);
        // don't advance lastSeenLt — we'll retry on the next poll
        return;
      }
      lastSeenLt = tx.lt;
    }
  } catch (e) {
    console.error('[indexer] poll error', e);
  } finally {
    running = false;
  }
}

/**
 * Parse a single TonAPI transaction. This is intentionally tolerant: TonAPI's
 * response shape evolves, and we'd rather no-op on an unrecognized message
 * than crash the indexer. Full body parsing (e.g. extracting the combined
 * seed from a WinnerDeclared payload) is left as a TODO until contract ABI
 * support stabilizes — for now the contract's emitted event op-code is
 * enough to mark the race settled, and the rest is reconciled from /webhook.
 */
async function processTx(tx) {
  const opIn = tx.in_msg?.op_code != null ? Number(tx.in_msg.op_code) : null;

  if (opIn === OP.TokenNotification) {
    // TODO: decode forwardPayload to get raceId, amount, from
    return handlers.Deposit({
      txHash: tx.hash,
      lt: tx.lt,
      raceId: null,   // populate after decoding
      from: tx.in_msg?.source?.address,
      amount: tx.in_msg?.value,
    });
  }

  if (opIn === OP.CommitHash) {
    return handlers.Commit({
      txHash: tx.hash, lt: tx.lt,
      raceId: null, player: tx.in_msg?.source?.address,
    });
  }
  if (opIn === OP.RevealSecret) {
    return handlers.Reveal({
      txHash: tx.hash, lt: tx.lt,
      raceId: null, player: tx.in_msg?.source?.address,
    });
  }

  for (const outMsg of tx.out_msgs || []) {
    const opOut = outMsg.op_code != null ? Number(outMsg.op_code) : null;
    if (opOut === OP.WinnerDeclared) {
      return handlers.WinnerDeclared({
        txHash: tx.hash, lt: tx.lt,
        // remaining fields decoded from outMsg.body once ABI parsing wired up
      });
    }
    if (opOut === OP.RaceRefunded) {
      return handlers.RaceRefunded({ txHash: tx.hash, lt: tx.lt });
    }
  }
}
