/**
 * On-chain → backend indexer (Toncenter v2 edition).
 *
 * Polls the escrow contract for new transactions and dispatches typed events:
 *
 *   incoming TokenNotification (0x7362d09c) → Deposit
 *   outgoing WinnerDeclared    (0x6c7263f1) → WinnerDeclared
 *   outgoing RaceRefunded      (0x6c7263f2) → RaceRefunded
 *
 * Message layouts (LadaEscrow v2):
 *
 *   TokenNotification  op(32) queryId(64) amount(coins) from(addr) forwardPayload(remaining)
 *                      → forwardPayload is a 64-bit uint raceId (inline, no Either prefix)
 *
 *   WinnerDeclared     op(32) raceId(64) winner(addr) loser(addr) combinedSeed(256)
 *                             pot(coins) payout(coins) houseFee(coins)
 *
 *   RaceRefunded       op(32) raceId(64) player1(addr) player2(addr) refundAmount(coins)
 */
import { Address, Cell } from '@ton/core';
import { config } from '../config.js';
import { getAccountTransactions, opCodeFrom } from './tonApi.js';
import { handlers } from './events.js';
import { query } from '../db/pool.js';

const OP = {
  TokenNotification: 0x7362d09c,
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
  console.log('[indexer] watching escrow:', config.ton.escrowAddress);

  const { rows } = await query(
    `SELECT MAX(lt)::text AS lt FROM transactions WHERE lt IS NOT NULL`,
  );
  lastSeenLt = rows[0]?.lt ?? null;
  console.log('[indexer] resuming from lt:', lastSeenLt ?? '(beginning)');

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

// ─── Cell body parsers ────────────────────────────────────────────────────────

function bodyB64(msg) {
  return msg?.msg_data?.body ?? msg?.body ?? null;
}

/**
 * Parse a TokenNotification body.
 * Layout: op(32) queryId(64) amount(coins) from(addr) forwardPayload(remaining)
 * forwardPayload must be exactly 64 inline bits (uint64 raceId).
 */
function parseTokenNotification(b64) {
  const s = Cell.fromBase64(b64).beginParse();
  s.loadUint(32);           // op
  s.loadUint(64);           // queryId
  const amount = s.loadCoins();
  const from   = s.loadAddress();

  let raceId = null;
  try {
    if (s.remainingBits >= 64) {
      raceId = s.loadUintBig(64);
    } else if (s.remainingRefs > 0) {
      // Fallback: some FunC jetton wallets wrap payload in a ref
      const ref = s.loadRef().beginParse();
      if (ref.remainingBits >= 64) raceId = ref.loadUintBig(64);
    }
  } catch (e) {
    console.warn('[indexer] parseTokenNotification: forwardPayload parse error:', e.message);
  }

  return {
    amount: amount.toString(),
    from:   from.toString({ urlSafe: true, bounceable: false }),
    raceId: raceId?.toString() ?? null,
  };
}

/**
 * Parse a WinnerDeclared event body.
 * Tact cell layout (compiled): pot is stored inline in the main cell;
 * payout + houseFee overflow into a reference cell (ref 0).
 *   main cell: op(32) raceId(64) winner(addr) loser(addr) combinedSeed(256) pot(coins)
 *   ref  cell: payout(coins) houseFee(coins)
 */
function parseWinnerDeclared(b64) {
  const s = Cell.fromBase64(b64).beginParse();
  s.loadUint(32);
  const raceId       = s.loadUintBig(64);
  const winner       = s.loadAddress();
  const loser        = s.loadAddress();
  const combinedSeed = s.loadUintBig(256);

  let pot = 0n, payout = 0n, houseFee = 0n;
  try {
    pot = s.loadCoins();
    // Tact overflows payout+houseFee into a ref cell when the main cell is full
    if (s.remainingRefs > 0) {
      const r = s.loadRef().beginParse();
      payout   = r.loadCoins();
      houseFee = r.loadCoins();
    } else {
      payout   = s.loadCoins();
      houseFee = s.loadCoins();
    }
  } catch (e) {
    console.warn('[indexer] parseWinnerDeclared: coin fields incomplete:', e.message);
  }

  return {
    raceId:      raceId.toString(),
    winner:      winner.toString({ urlSafe: true, bounceable: false }),
    loser:       loser.toString({ urlSafe: true, bounceable: false }),
    combinedSeed: '0x' + combinedSeed.toString(16).padStart(64, '0'),
    pot:         pot.toString(),
    payout:      payout.toString(),
    houseFee:    houseFee.toString(),
  };
}

/**
 * Parse a RaceRefunded event body.
 * Layout: op(32) raceId(64) player1(addr) player2(addr) refundAmount(coins)
 */
function parseRaceRefunded(b64) {
  const s = Cell.fromBase64(b64).beginParse();
  s.loadUint(32);
  const raceId = s.loadUintBig(64);
  s.loadAddress();   // player1
  s.loadAddress();   // player2
  const refundAmount = s.loadCoins();
  return { raceId: raceId.toString(), refundAmount: refundAmount.toString() };
}

// ─── Transaction processor ────────────────────────────────────────────────────

async function processTx(tx) {
  const hash = tx.transaction_id?.hash || tx.hash;
  const lt   = tx.transaction_id?.lt   || tx.lt;

  // ── Inbound messages ──
  if (tx.in_msg) {
    const b64  = bodyB64(tx.in_msg);
    const opIn = opCodeFrom(tx.in_msg);

    if (opIn === OP.TokenNotification && b64) {
      let parsed = {};
      try { parsed = parseTokenNotification(b64); } catch (e) {
        console.warn('[indexer] TokenNotification parse error:', e.message);
      }
      console.log(`[indexer] Deposit | raceId=${parsed.raceId} from=${parsed.from} amount=${parsed.amount}`);
      return handlers.Deposit({ txHash: hash, lt, ...parsed });
    }
  }

  // ── Outbound events emitted by the contract ──
  for (const outMsg of tx.out_msgs || []) {
    const b64   = bodyB64(outMsg);
    const opOut = opCodeFrom(outMsg);

    if (opOut === OP.WinnerDeclared && b64) {
      let parsed = {};
      try { parsed = parseWinnerDeclared(b64); } catch (e) {
        console.warn('[indexer] WinnerDeclared parse error:', e.message);
      }
      console.log(`[indexer] WinnerDeclared | raceId=${parsed.raceId} winner=${parsed.winner} payout=${parsed.payout}`);
      return handlers.WinnerDeclared({ txHash: hash, lt, ...parsed });
    }

    if (opOut === OP.RaceRefunded && b64) {
      let parsed = {};
      try { parsed = parseRaceRefunded(b64); } catch (e) {
        console.warn('[indexer] RaceRefunded parse error:', e.message);
      }
      console.log(`[indexer] RaceRefunded | raceId=${parsed.raceId} refundAmount=${parsed.refundAmount}`);
      return handlers.RaceRefunded({ txHash: hash, lt, ...parsed });
    }
  }
}
