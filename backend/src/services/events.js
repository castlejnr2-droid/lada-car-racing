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
import { TonClient } from '@ton/ton';
import { query } from '../db/pool.js';
import { payoutRace } from './housePayout.js';
import { config } from '../config.js';

// STATE_FUNDED = 1  (matches lada_escrow.tact constant)
const STATE_FUNDED = 1;

let _tonClient = null;
function getTonClient() {
  if (_tonClient) return _tonClient;
  const endpoint = config.ton.network === 'mainnet'
    ? 'https://toncenter.com/api/v2/jsonRPC'
    : 'https://testnet.toncenter.com/api/v2/jsonRPC';
  _tonClient = new TonClient({ endpoint, apiKey: config.ton.apiKey || undefined });
  return _tonClient;
}

/**
 * Query raceOf(raceId) on the escrow contract.
 * Returns all Race struct fields, or null if the race doesn't exist / call fails.
 *
 * Tact nullable getter: stack.readTupleOpt() returns null when Race? is null,
 * or a TupleReader over the struct fields in declaration order:
 *   stake(coins) player1(addr) player2(addr) deposited1(bool) deposited2(bool) state(uint8)
 */
async function getOnChainRace(raceIdStr) {
  const escrow = config.ton.escrowAddress;
  if (!escrow) return null;
  try {
    const client = getTonClient();
    const result = await client.runMethod(
      Address.parse(escrow),
      'raceOf',
      [{ type: 'int', value: BigInt(raceIdStr) }],
    );

    // @ton/ton@15.x + toncenter v2: readTupleOpt() returns a TupleReader whose
    // .items are raw values produced by parseStackEntry — BigInt for integers,
    // Cell for slices/cells — NOT the { type, value } TupleItem objects that
    // readBigNumber() / readAddress() / readBoolean() expect.  Using those
    // methods therefore throws "Not a number" even when the race exists.
    // Fix: read the outer stack item directly and access .items ourselves.
    const outerItem = result.stack.items[0];
    if (!outerItem || outerItem.type === 'null') return null;   // race not on-chain
    if (outerItem.type !== 'tuple') {
      console.warn(`[events] getOnChainRace(${raceIdStr}): unexpected stack item type "${outerItem.type}"`);
      return null;
    }

    const it = outerItem.items;   // [stake, p1Cell, p2Cell, dep1, dep2, state] — raw values
    if (it.length < 6) return null;

    // it[0] = stake   : BigInt (nanocoins)
    // it[1] = player1 : Cell  (address slice)
    // it[2] = player2 : Cell  (address slice)
    // it[3] = dep1    : BigInt  (-1n = true, 0n = false)
    // it[4] = dep2    : BigInt  (-1n = true, 0n = false)
    // it[5] = state   : BigInt  (0n = AWAITING_DEPOSITS, 1n = FUNDED)
    const stake      = it[0];
    const player1    = it[1].beginParse().loadAddress();
    const player2    = it[2].beginParse().loadAddress();
    const deposited1 = it[3] !== 0n;
    const deposited2 = it[4] !== 0n;
    const state      = Number(it[5]);

    return {
      state,
      stake:      stake.toString(),
      player1:    player1.toString({ urlSafe: true, bounceable: false }),
      player2:    player2.toString({ urlSafe: true, bounceable: false }),
      deposited1,
      deposited2,
    };
  } catch (e) {
    console.warn(`[events] getOnChainRace(${raceIdStr}) failed:`, e.message);
    return null;
  }
}

// ── Server-side race physics (mirrors frontend game/rng.js + game/physics.js) ──
// MUST stay in sync with the frontend implementations so the animation winner
// matches the declared winner exactly.

function _seedFromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  let acc = 0;
  for (let i = 0; i < clean.length; i += 8) {
    acc ^= parseInt(clean.slice(i, i + 8).padEnd(8, '0'), 16) >>> 0;
  }
  return acc >>> 0;
}

function _createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _TRACK_LENGTH      = 1200;
const _POTHOLES_PER_LANE = 14;
const _BASE_SPEED        = 6;
const _POTHOLE_PENALTY   = 0.35;
const _POTHOLE_HIT_RAD   = 5;
const _MAX_TICKS         = 600;

/**
 * Run the same deterministic physics simulation as the frontend and return
 * the winning car index (0 = player1, 1 = player2).
 */
function computeWinnerIndex(seedHex) {
  const rng = _createRng(_seedFromHex(seedHex));

  // buildTrack (2 lanes)
  const lanes = [];
  for (let l = 0; l < 2; l++) {
    const potholes = [];
    for (let i = 0; i < _POTHOLES_PER_LANE; i++) {
      potholes.push(80 + Math.floor(rng() * (_TRACK_LENGTH - 80)));
    }
    lanes.push({ potholes: potholes.sort((a, b) => a - b) });
  }

  // simulate
  const positions = [0, 0];
  let tick = 0;
  while (positions.some((p) => p < _TRACK_LENGTH) && tick < _MAX_TICKS) {
    for (let i = 0; i < 2; i++) {
      if (positions[i] >= _TRACK_LENGTH) continue;
      const onPothole = lanes[i].potholes.some(
        (p) => Math.abs(p - positions[i]) < _POTHOLE_HIT_RAD,
      );
      const jitter = 0.85 + rng() * 0.3;
      positions[i] += _BASE_SPEED * (onPothole ? _POTHOLE_PENALTY : 1) * jitter;
    }
    tick++;
  }

  return positions[1] > positions[0] ? 1 : 0;
}

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
            player1_deposited, player2_deposited, stake::text
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
  console.log(`[events.Deposit] ── incoming ──────────────────────────`);
  console.log(`[events.Deposit] txHash=${e.txHash} lt=${e.lt}`);
  console.log(`[events.Deposit] raceId(chain)=${e.raceId}  amount=${e.amount}`);
  console.log(`[events.Deposit] from=${e.from}`);

  // ── 1. Find the race by on-chain ID ──────────────────────────────
  const race = await raceRowFor(e.raceId);
  if (!race) {
    console.warn(`[events.Deposit] ✗ no race found for on_chain_id=${e.raceId} — skipping`);
    // Dump all on_chain_ids for debugging
    const { rows: allIds } = await query(
      `SELECT on_chain_id::text, state FROM races ORDER BY created_at DESC LIMIT 10`,
    );
    console.warn(`[events.Deposit] known on_chain_ids (newest 10):`, allIds.map(r => `${r.on_chain_id}(${r.state})`).join(', '));
    return { skipped: true, reason: 'unknown race' };
  }
  console.log(`[events.Deposit] ✓ race found id=${race.id} lobby_id=${race.lobby_id}`);
  console.log(`[events.Deposit]   state=${race.state}  p1_dep=${race.player1_deposited}  p2_dep=${race.player2_deposited}`);
  console.log(`[events.Deposit]   player1=${race.player1}`);
  console.log(`[events.Deposit]   player2=${race.player2}`);

  // ── 2. Dedup ──────────────────────────────────────────────────────
  const fresh = await recordTx({
    txHash: e.txHash, lt: e.lt, type: 'deposit',
    raceId: race.id, player: e.from, amount: e.amount, raw: e,
  });
  if (!fresh) {
    console.log(`[events.Deposit] duplicate tx — skipping`);
    return { skipped: true, reason: 'duplicate' };
  }

  // ── 3. Normalize addresses for comparison ─────────────────────────
  const fromNorm = normalizeAddr(e.from);
  const p1Norm   = normalizeAddr(race.player1);
  const p2Norm   = normalizeAddr(race.player2);
  console.log(`[events.Deposit] normalized from=${fromNorm}`);
  console.log(`[events.Deposit] normalized   p1=${p1Norm}`);
  console.log(`[events.Deposit] normalized   p2=${p2Norm}`);

  const isP1 = Boolean(fromNorm && p1Norm && fromNorm === p1Norm);
  const isP2 = Boolean(fromNorm && p2Norm && fromNorm === p2Norm);
  console.log(`[events.Deposit] isP1=${isP1}  isP2=${isP2}`);

  if (!isP1 && !isP2) {
    console.warn(`[events.Deposit] ✗ depositor is neither player — ignoring`);
    return { skipped: true, reason: 'unknown player' };
  }

  // ── 4. Update deposit flags in races ─────────────────────────────
  const newP1dep = race.player1_deposited || isP1;
  const newP2dep = race.player2_deposited || isP2;
  console.log(`[events.Deposit] p1_dep: ${race.player1_deposited}→${newP1dep} | p2_dep: ${race.player2_deposited}→${newP2dep}`);

  await query(
    `UPDATE races SET player1_deposited=$2, player2_deposited=$3 WHERE id=$1`,
    [race.id, newP1dep, newP2dep],
  );

  // ── 5. Both deposited → determine winner and trigger payout ───────
  if (newP1dep && newP2dep && race.state === 'awaiting_deposits') {
    console.log(`[events.Deposit] BOTH deposited — generating winner and triggering payout`);

    // Generate a cryptographically random 256-bit seed server-side
    const seedBytes = randomBytes(32);
    const seedHex   = '0x' + seedBytes.toString('hex');

    // Determine winner using the same deterministic physics simulation as the
    // frontend animation — winnerIdx 0 = player1, 1 = player2.
    const winnerIdx = computeWinnerIndex(seedHex);
    const winner    = winnerIdx === 0 ? race.player1 : race.player2;
    const loser     = winnerIdx === 0 ? race.player2 : race.player1;
    console.log(`[events.Deposit] seed=${seedHex}`);
    console.log(`[events.Deposit] winnerIdx=${winnerIdx} winner=${winner}`);

    // Advance to 'active' and store winner + seed so both players' screens
    // can transition to race gameplay immediately, without waiting for the
    // on-chain WinnerDeclared confirmation.
    await query(
      `UPDATE races SET state='active', combined_seed=$2, winner=$3, loser=$4 WHERE id=$1`,
      [race.id, seedHex, winner, loser],
    );

    // Compute expected payout amounts for the DB record (mirrors contract logic).
    const potBigInt    = BigInt(race.stake) * 2n;
    const winnerPayout = potBigInt - (potBigInt * 500n / 10000n);  // 95 %
    const houseFee     = potBigInt - winnerPayout;                  // 5 %

    // Verify the escrow's on-chain race is actually FUNDED before sending Payout.
    // The indexer credits deposits even when the escrow refunds them (e.g. wrong
    // player, forwardPayload issue), so the on-chain and DB states can diverge.
    console.log(`[events.Deposit] ════════════ RACE STATE CHECK (before payout) ════════════`);
    const onChainRace = await getOnChainRace(race.on_chain_id);

    if (!onChainRace) {
      console.error(`[events.Deposit] raceOf(${race.on_chain_id}) → null (race not on-chain; CreateRace may not be confirmed yet)`);
      console.error(`[events.Deposit] ✗ Aborting Payout — on-chain race not found`);
      console.log(`[events.Deposit] ═══════════════════════════════════════════════════════════`);
      return { ok: false, reason: 'race_not_on_chain' };
    }

    console.log(`[events.Deposit] raceOf(${race.on_chain_id}):`);
    console.log(`[events.Deposit]   state     = ${onChainRace.state} (0=AWAITING_DEPOSITS 1=FUNDED)`);
    console.log(`[events.Deposit]   stake     = ${onChainRace.stake}`);
    console.log(`[events.Deposit]   player1   = ${onChainRace.player1}`);
    console.log(`[events.Deposit]   player2   = ${onChainRace.player2}`);
    console.log(`[events.Deposit]   deposited1= ${onChainRace.deposited1}`);
    console.log(`[events.Deposit]   deposited2= ${onChainRace.deposited2}`);

    if (onChainRace.state !== STATE_FUNDED) {
      console.error(`[events.Deposit] ✗ state=${onChainRace.state} expected 1=FUNDED — Aborting Payout`);
      console.log(`[events.Deposit] ═══════════════════════════════════════════════════════════`);
      return { ok: false, reason: 'race_not_funded' };
    }

    console.log(`[events.Deposit] ✓ state=FUNDED — firing Payout op | winner=${winner}`);
    payoutRace({
      raceId: race.on_chain_id,
      winner,
    }).then(async () => {
      console.log(`[events.Deposit] payoutRace TX sent for race=${race.id}`);
      await query(
        `UPDATE races
            SET winner_payout = $2,
                house_fee     = $3
          WHERE id = $1`,
        [race.id, winnerPayout.toString(), houseFee.toString()],
      );
      // Re-check on-chain state ~3 s after sending, so we can see if the
      // escrow accepted or bounced the Payout op.
      await new Promise((r) => setTimeout(r, 3000));
      console.log(`[events.Deposit] ════════════ RACE STATE CHECK (after payout) ════════════`);
      const afterRace = await getOnChainRace(race.on_chain_id);
      if (!afterRace) {
        console.log(`[events.Deposit] raceOf(${race.on_chain_id}) → null (race settled+cleaned up ✓)`);
      } else {
        console.log(`[events.Deposit] raceOf(${race.on_chain_id}) after payout TX:`);
        console.log(`[events.Deposit]   state     = ${afterRace.state} (0=AWAITING_DEPOSITS 1=FUNDED)`);
        console.log(`[events.Deposit]   stake     = ${afterRace.stake}`);
        console.log(`[events.Deposit]   deposited1= ${afterRace.deposited1}`);
        console.log(`[events.Deposit]   deposited2= ${afterRace.deposited2}`);
      }
    }).catch((err) => {
      console.error(`[events.Deposit] payoutRace FAILED for race=${race.id}:`, err.message);
      console.error(`[events.Deposit] admin can retry: on_chain_id=${race.on_chain_id} winner=${winner}`);
    });
    console.log(`[events.Deposit] ═══════════════════════════════════════════════════════════`);
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
