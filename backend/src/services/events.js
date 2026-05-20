/**
 * Event handlers — one per event type the contract or jetton wallet emits.
 *
 * Called from /api/webhook/event when the indexer parses an on-chain event.
 * Each handler is idempotent (uses ON CONFLICT) so duplicate webhook deliveries
 * don't double-credit a player or double-record a fee.
 */
import { query } from '../db/pool.js';

/**
 * Record a tx row. Returns false if we've already seen this (tx_hash, type) pair.
 */
async function recordTx({ txHash, lt, type, raceId, player, amount, raw }) {
  const { rowCount } = await query(
    `INSERT INTO transactions (tx_hash, lt, type, race_id, player, amount, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, type) DO NOTHING`,
    [txHash, lt ?? null, type, raceId ?? null, player ?? null, amount ?? null, raw ?? null],
  );
  return rowCount > 0;
}

/**
 * Look up the internal race UUID for an on-chain race id.
 * Returns null if the race hasn't been registered locally yet (the indexer
 * may be ahead of the backend; we just skip the event in that case).
 */
async function raceIdFor(onChainId) {
  const { rows } = await query(
    `SELECT id FROM races WHERE on_chain_id = $1`,
    [onChainId],
  );
  return rows[0]?.id ?? null;
}

// ──────────────────────────────────────────────────────────────────────
//  Deposit — jetton arrived at the escrow contract
// ──────────────────────────────────────────────────────────────────────
export async function handleDeposit(e) {
  const raceId = await raceIdFor(e.raceId);
  if (!raceId) return { skipped: true, reason: 'unknown race' };

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'deposit',
    raceId, player: e.from, amount: e.amount, raw: e,
  });
  if (!fresh) return { skipped: true, reason: 'duplicate' };

  await query(
    `UPDATE races
        SET player1_deposited = (player1_deposited OR player1 = $2),
            player2_deposited = (player2_deposited OR player2 = $2)
      WHERE id = $1`,
    [raceId, e.from],
  );
  // If both deposited, advance state
  await query(
    `UPDATE races
        SET state = 'awaiting_commits'
      WHERE id = $1
        AND state = 'awaiting_deposits'
        AND player1_deposited AND player2_deposited`,
    [raceId],
  );
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  Commit — player submitted hash(secret)
// ──────────────────────────────────────────────────────────────────────
export async function handleCommit(e) {
  const raceId = await raceIdFor(e.raceId);
  if (!raceId) return { skipped: true, reason: 'unknown race' };

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'commit',
    raceId, player: e.player, raw: e,
  });
  if (!fresh) return { skipped: true, reason: 'duplicate' };

  await query(
    `UPDATE races
        SET player1_committed = (player1_committed OR player1 = $2),
            player2_committed = (player2_committed OR player2 = $2)
      WHERE id = $1`,
    [raceId, e.player],
  );
  await query(
    `UPDATE races
        SET state = 'awaiting_reveals'
      WHERE id = $1
        AND state = 'awaiting_commits'
        AND player1_committed AND player2_committed`,
    [raceId],
  );
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  Reveal — player revealed their secret (settle may also have fired)
// ──────────────────────────────────────────────────────────────────────
export async function handleReveal(e) {
  const raceId = await raceIdFor(e.raceId);
  if (!raceId) return { skipped: true, reason: 'unknown race' };

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'reveal',
    raceId, player: e.player, raw: e,
  });
  if (!fresh) return { skipped: true, reason: 'duplicate' };

  await query(
    `UPDATE races
        SET player1_revealed = (player1_revealed OR player1 = $2),
            player2_revealed = (player2_revealed OR player2 = $2)
      WHERE id = $1`,
    [raceId, e.player],
  );
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  WinnerDeclared — settlement event from the escrow contract
// ──────────────────────────────────────────────────────────────────────
export async function handleWinnerDeclared(e) {
  const raceId = await raceIdFor(e.raceId);
  if (!raceId) return { skipped: true, reason: 'unknown race' };

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'payout',
    raceId, player: e.winner, amount: e.payout, raw: e,
  });
  if (!fresh) return { skipped: true, reason: 'duplicate' };

  await query(
    `UPDATE races
        SET state          = 'settled',
            winner         = $2,
            loser          = $3,
            combined_seed  = $4,
            winner_payout  = $5,
            house_fee      = $6,
            settle_tx_hash = $7,
            finished_at    = now()
      WHERE id = $1`,
    [raceId, e.winner, e.loser, e.combinedSeed, e.payout, e.houseFee, e.txHash],
  );

  // Record the house fee
  await query(
    `INSERT INTO house_fees (race_id, amount, tx_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (race_id) DO NOTHING`,
    [raceId, e.houseFee, e.txHash],
  );
  await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'house_fee',
    raceId, amount: e.houseFee, raw: e,
  });
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  RaceRefunded — both players got their stake back after a timeout
// ──────────────────────────────────────────────────────────────────────
export async function handleRaceRefunded(e) {
  const raceId = await raceIdFor(e.raceId);
  if (!raceId) return { skipped: true, reason: 'unknown race' };

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'refund',
    raceId, amount: e.refundAmount, raw: e,
  });
  if (!fresh) return { skipped: true, reason: 'duplicate' };

  await query(
    `UPDATE races
        SET state       = 'refunded',
            finished_at = now()
      WHERE id = $1`,
    [raceId],
  );
  return { ok: true };
}

export const handlers = {
  Deposit:         handleDeposit,
  Commit:          handleCommit,
  Reveal:          handleReveal,
  WinnerDeclared:  handleWinnerDeclared,
  RaceRefunded:    handleRaceRefunded,
};
