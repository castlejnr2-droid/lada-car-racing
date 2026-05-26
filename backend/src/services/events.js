/**
 * Event handlers — one per event type the contract or jetton wallet emits.
 *
 * Called from the indexer when it parses an on-chain event.
 * Each handler is idempotent (uses ON CONFLICT) so duplicate deliveries
 * don't double-credit a player or double-record a fee.
 */
import { Address } from '@ton/core';
import { query } from '../db/pool.js';

/**
 * Normalize any TON address format to raw "0:hex" string for SQL comparison.
 * Returns null if the input is falsy or unparseable.
 */
function normalizeAddr(a) {
  if (!a) return null;
  try {
    return Address.parse(a).toRawString();
  } catch {
    console.warn('[events] could not normalize address:', a);
    return a; // fall back to original so we don't silently lose data
  }
}

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
 * Look up the race row by on-chain race id.
 * Returns null if the race hasn't been registered locally yet.
 */
async function raceRowFor(onChainId) {
  const { rows } = await query(
    `SELECT id, state, player1, player2,
            player1_deposited, player2_deposited,
            player1_committed, player2_committed,
            player1_revealed,  player2_revealed
       FROM races
      WHERE on_chain_id = $1`,
    [onChainId],
  );
  return rows[0] ?? null;
}

// ──────────────────────────────────────────────────────────────────────
//  Deposit — jetton arrived at the escrow contract
// ──────────────────────────────────────────────────────────────────────
export async function handleDeposit(e) {
  console.log(`[events.Deposit] from=${e.from} raceId(chain)=${e.raceId} amount=${e.amount} txHash=${e.txHash}`);

  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.Deposit] unknown on-chain raceId=${e.raceId} — skipping`);
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.Deposit] found race id=${race.id} state=${race.state} p1=${race.player1} p2=${race.player2}`);

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'deposit',
    raceId: race.id, player: e.from, amount: e.amount, raw: e,
  });
  if (!fresh) {
    console.log(`[events.Deposit] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  // Normalize all addresses to raw "0:hex" before comparing
  const fromNorm = normalizeAddr(e.from);
  const p1Norm   = normalizeAddr(race.player1);
  const p2Norm   = normalizeAddr(race.player2);
  console.log(`[events.Deposit] normalized: from=${fromNorm} p1=${p1Norm} p2=${p2Norm}`);

  const isP1 = fromNorm && p1Norm && fromNorm === p1Norm;
  const isP2 = fromNorm && p2Norm && fromNorm === p2Norm;
  console.log(`[events.Deposit] isP1=${isP1} isP2=${isP2}`);

  if (!isP1 && !isP2) {
    console.warn(`[events.Deposit] depositor ${fromNorm} is neither player1 (${p1Norm}) nor player2 (${p2Norm}) — ignoring`);
    return { skipped: true, reason: 'unknown player' };
  }

  const newP1dep = race.player1_deposited || isP1;
  const newP2dep = race.player2_deposited || isP2;
  console.log(`[events.Deposit] p1_deposited: ${race.player1_deposited} → ${newP1dep} | p2_deposited: ${race.player2_deposited} → ${newP2dep}`);

  await query(
    `UPDATE races
        SET player1_deposited = $2,
            player2_deposited = $3
      WHERE id = $1`,
    [race.id, newP1dep, newP2dep],
  );

  if (newP1dep && newP2dep && race.state === 'awaiting_deposits') {
    console.log(`[events.Deposit] BOTH deposited — advancing state to awaiting_commits`);
    const { rowCount } = await query(
      `UPDATE races
          SET state = 'awaiting_commits'
        WHERE id = $1
          AND state = 'awaiting_deposits'`,
      [race.id],
    );
    console.log(`[events.Deposit] state UPDATE rowCount=${rowCount}`);
  } else {
    console.log(`[events.Deposit] waiting for other deposit (p1=${newP1dep} p2=${newP2dep} state=${race.state})`);
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  Commit — player submitted hash(secret)
// ──────────────────────────────────────────────────────────────────────
export async function handleCommit(e) {
  console.log(`[events.Commit] player=${e.player} raceId(chain)=${e.raceId} txHash=${e.txHash}`);

  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.Commit] unknown on-chain raceId=${e.raceId} — skipping`);
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.Commit] found race id=${race.id} state=${race.state}`);

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'commit',
    raceId: race.id, player: e.player, raw: e,
  });
  if (!fresh) {
    console.log(`[events.Commit] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  const playerNorm = normalizeAddr(e.player);
  const p1Norm     = normalizeAddr(race.player1);
  const p2Norm     = normalizeAddr(race.player2);

  const isP1 = playerNorm && p1Norm && playerNorm === p1Norm;
  const isP2 = playerNorm && p2Norm && playerNorm === p2Norm;
  console.log(`[events.Commit] isP1=${isP1} isP2=${isP2}`);

  const newP1com = race.player1_committed || isP1;
  const newP2com = race.player2_committed || isP2;
  console.log(`[events.Commit] p1_committed: ${race.player1_committed} → ${newP1com} | p2_committed: ${race.player2_committed} → ${newP2com}`);

  await query(
    `UPDATE races
        SET player1_committed = $2,
            player2_committed = $3
      WHERE id = $1`,
    [race.id, newP1com, newP2com],
  );

  if (newP1com && newP2com && race.state === 'awaiting_commits') {
    console.log(`[events.Commit] BOTH committed — advancing state to awaiting_reveals`);
    const { rowCount } = await query(
      `UPDATE races
          SET state = 'awaiting_reveals'
        WHERE id = $1
          AND state = 'awaiting_commits'`,
      [race.id],
    );
    console.log(`[events.Commit] state UPDATE rowCount=${rowCount}`);
  } else {
    console.log(`[events.Commit] waiting for other commit (p1=${newP1com} p2=${newP2com} state=${race.state})`);
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  Reveal — player revealed their secret (settle may also have fired)
// ──────────────────────────────────────────────────────────────────────
export async function handleReveal(e) {
  console.log(`[events.Reveal] player=${e.player} raceId(chain)=${e.raceId} txHash=${e.txHash}`);

  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.Reveal] unknown on-chain raceId=${e.raceId} — skipping`);
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.Reveal] found race id=${race.id} state=${race.state}`);

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'reveal',
    raceId: race.id, player: e.player, raw: e,
  });
  if (!fresh) {
    console.log(`[events.Reveal] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  const playerNorm = normalizeAddr(e.player);
  const p1Norm     = normalizeAddr(race.player1);
  const p2Norm     = normalizeAddr(race.player2);

  const isP1 = playerNorm && p1Norm && playerNorm === p1Norm;
  const isP2 = playerNorm && p2Norm && playerNorm === p2Norm;
  console.log(`[events.Reveal] isP1=${isP1} isP2=${isP2}`);

  const newP1rev = race.player1_revealed || isP1;
  const newP2rev = race.player2_revealed || isP2;
  console.log(`[events.Reveal] p1_revealed: ${race.player1_revealed} → ${newP1rev} | p2_revealed: ${race.player2_revealed} → ${newP2rev}`);

  await query(
    `UPDATE races
        SET player1_revealed = $2,
            player2_revealed = $3
      WHERE id = $1`,
    [race.id, newP1rev, newP2rev],
  );

  console.log(`[events.Reveal] done (contract will auto-settle on 2nd reveal — waiting for WinnerDeclared event)`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  WinnerDeclared — settlement event from the escrow contract
// ──────────────────────────────────────────────────────────────────────
export async function handleWinnerDeclared(e) {
  console.log(`[events.WinnerDeclared] raceId(chain)=${e.raceId} winner=${e.winner} payout=${e.payout} houseFee=${e.houseFee} txHash=${e.txHash}`);

  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.WinnerDeclared] unknown on-chain raceId=${e.raceId} — skipping`);
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.WinnerDeclared] found race id=${race.id} state=${race.state}`);

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'payout',
    raceId: race.id, player: e.winner, amount: e.payout, raw: e,
  });
  if (!fresh) {
    console.log(`[events.WinnerDeclared] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  const { rowCount } = await query(
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
    [race.id, e.winner, e.loser, e.combinedSeed, e.payout, e.houseFee, e.txHash],
  );
  console.log(`[events.WinnerDeclared] race UPDATE rowCount=${rowCount} → state=settled winner=${e.winner}`);

  // Record the house fee
  await query(
    `INSERT INTO house_fees (race_id, amount, tx_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (race_id) DO NOTHING`,
    [race.id, e.houseFee, e.txHash],
  );
  await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'house_fee',
    raceId: race.id, amount: e.houseFee, raw: e,
  });

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  RaceRefunded — both players got their stake back after a timeout
// ──────────────────────────────────────────────────────────────────────
export async function handleRaceRefunded(e) {
  console.log(`[events.RaceRefunded] raceId(chain)=${e.raceId} refundAmount=${e.refundAmount} txHash=${e.txHash}`);

  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.RaceRefunded] unknown on-chain raceId=${e.raceId} — skipping`);
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.RaceRefunded] found race id=${race.id} state=${race.state}`);

  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'refund',
    raceId: race.id, amount: e.refundAmount, raw: e,
  });
  if (!fresh) {
    console.log(`[events.RaceRefunded] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  const { rowCount } = await query(
    `UPDATE races
        SET state       = 'refunded',
            finished_at = now()
      WHERE id = $1`,
    [race.id],
  );
  console.log(`[events.RaceRefunded] race UPDATE rowCount=${rowCount} → state=refunded`);

  return { ok: true };
}

export const handlers = {
  Deposit:         handleDeposit,
  Commit:          handleCommit,
  Reveal:          handleReveal,
  WinnerDeclared:  handleWinnerDeclared,
  RaceRefunded:    handleRaceRefunded,
};
