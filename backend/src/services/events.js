/**
 * Event handlers — one per event type the contract emits.
 *
 * Called from the indexer when it parses an on-chain event.
 * Each handler is idempotent (uses ON CONFLICT) so duplicate deliveries
 * don't double-credit a player or double-record a fee.
 *
 * New lifecycle (LadaEscrow v2 — owner payout):
 *   1. Both players deposit → handleDeposit generates winner server-side,
 *      stores winner/seed in DB, fires payoutRace() on-chain (fire-and-forget).
 *   2. Contract emits WinnerDeclared → handleWinnerDeclared sets state=settled.
 *   3. If refund: handleRaceRefunded sets state=refunded.
 */
import { randomBytes } from 'crypto';
import { Address } from '@ton/core';
import { query } from '../db/pool.js';
import { payoutRace } from './housePayout.js';

/**
 * Normalize any TON address format to raw "0:hex" for comparison.
 * Returns null if the input is falsy or unparseable.
 */
function normalizeAddr(a) {
  if (!a) return null;
  try {
    return Address.parse(a).toRawString();
  } catch {
    console.warn('[events] could not normalize address:', a);
    return a;
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
 * Look up the race row by on-chain race id (includes all fields needed for payout).
 */
async function raceRowFor(onChainId) {
  const { rows } = await query(
    `SELECT id, lobby_id, on_chain_id::text, state, player1, player2,
            player1_deposited, player2_deposited
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
    console.warn(`[events.Deposit] depositor ${fromNorm} is neither player — ignoring`);
    return { skipped: true, reason: 'unknown player' };
  }

  const newP1dep = race.player1_deposited || isP1;
  const newP2dep = race.player2_deposited || isP2;
  console.log(`[events.Deposit] p1_dep: ${race.player1_deposited}→${newP1dep} | p2_dep: ${race.player2_deposited}→${newP2dep}`);

  await query(
    `UPDATE races SET player1_deposited=$2, player2_deposited=$3 WHERE id=$1`,
    [race.id, newP1dep, newP2dep],
  );

  // FIX 2: When player1 (host) deposits, open the lobby so player2 can join.
  // The lobby starts as 'pending' and only becomes visible after host's deposit.
  if (isP1 && !race.player1_deposited && race.lobby_id) {
    const upd = await query(
      `UPDATE lobbies SET status='open' WHERE id=$1 AND status='pending' RETURNING id`,
      [race.lobby_id],
    );
    if (upd.rowCount > 0) {
      console.log(`[events.Deposit] host deposit confirmed → lobby=${race.lobby_id} opened`);
    }
  }

  if (newP1dep && newP2dep && race.state === 'awaiting_deposits') {
    console.log(`[events.Deposit] BOTH deposited — generating winner and triggering payout`);

    // Generate a cryptographically random 256-bit seed server-side
    const seedBytes  = randomBytes(32);
    const seedHex    = '0x' + seedBytes.toString('hex');
    const seedBigInt = BigInt(seedHex);

    // Determine winner: if seed is even → player1 wins; odd → player2 wins
    const winner = seedBigInt % 2n === 0n ? race.player1 : race.player2;
    const loser  = winner === race.player1 ? race.player2 : race.player1;
    console.log(`[events.Deposit] winner=${winner} seed=${seedHex}`);

    // Store winner + seed in DB now (so admin can see them even if on-chain payout fails)
    await query(
      `UPDATE races SET combined_seed=$2, winner=$3, loser=$4 WHERE id=$1`,
      [race.id, seedHex, winner, loser],
    );

    // Fire payout on-chain — fire-and-forget.
    // WinnerDeclared event will set state=settled once the tx lands.
    payoutRace({
      raceId: race.on_chain_id,
      winner,
      seed: seedBigInt,
    }).then(() => {
      console.log(`[events.Deposit] payoutRace sent OK for race=${race.id}`);
    }).catch((err) => {
      console.error(`[events.Deposit] payoutRace FAILED for race=${race.id}:`, err.message);
      console.error(`[events.Deposit] admin can retry payout manually for on_chain_id=${race.on_chain_id}`);
    });
  } else if (newP1dep || newP2dep) {
    console.log(`[events.Deposit] one deposit in, waiting for other (p1=${newP1dep} p2=${newP2dep})`);
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
//  WinnerDeclared — settlement event from the escrow contract
// ──────────────────────────────────────────────────────────────────────
export async function handleWinnerDeclared(e) {
  console.log(`[events.WinnerDeclared] raceId(chain)=${e.raceId} winner=${e.winner} payout=${e.payout} txHash=${e.txHash}`);

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
            winner         = COALESCE(winner, $2),
            loser          = COALESCE(loser, $3),
            combined_seed  = COALESCE(combined_seed, $4),
            winner_payout  = $5,
            house_fee      = $6,
            settle_tx_hash = $7,
            finished_at    = COALESCE(finished_at, now())
      WHERE id = $1`,
    [race.id, e.winner, e.loser, e.combinedSeed, e.payout, e.houseFee, e.txHash],
  );
  console.log(`[events.WinnerDeclared] UPDATE rowCount=${rowCount} → state=settled winner=${e.winner}`);

  // Record house fee bookkeeping row
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
//  RaceRefunded — owner triggered a refund
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
    `UPDATE races SET state='refunded', finished_at=now() WHERE id=$1`,
    [race.id],
  );
  console.log(`[events.RaceRefunded] UPDATE rowCount=${rowCount} → state=refunded`);

  return { ok: true };
}

export const handlers = {
  Deposit:         handleDeposit,
  WinnerDeclared:  handleWinnerDeclared,
  RaceRefunded:    handleRaceRefunded,
};
