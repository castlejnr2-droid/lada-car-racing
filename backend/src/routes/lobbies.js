import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { createRaceOnChain } from '../services/housePayout.js';

// ─── Physics simulation (mirrors frontend/src/game/rng.js + physics.js) ──────
// Kept in sync by design — both files use the same constants and algorithm.

function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromHex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  let acc = 0;
  for (let i = 0; i < clean.length; i += 8) {
    acc ^= parseInt(clean.slice(i, i + 8).padEnd(8, '0'), 16) >>> 0;
  }
  return acc >>> 0;
}

const TRACK_LENGTH      = 1200;
const POTHOLES_PER_LANE = 14;
const BASE_SPEED        = 6;
const POTHOLE_PENALTY   = 0.35;
const POTHOLE_HIT_RADIUS = 5;
const MAX_TICKS         = 600;

function buildTrack(rng, laneCount) {
  const lanes = [];
  for (let l = 0; l < laneCount; l++) {
    const potholes = [];
    for (let i = 0; i < POTHOLES_PER_LANE; i++) {
      potholes.push(80 + Math.floor(rng() * (TRACK_LENGTH - 80)));
    }
    lanes.push({ potholes: potholes.sort((a, b) => a - b) });
  }
  return { length: TRACK_LENGTH, lanes };
}

/**
 * Run the deterministic race simulation and return the index of the winner.
 * Mirrors the frontend simulate() exactly so the visual replay always matches.
 * Winner = car with highest final position (first to cross the finish line
 * gets the extra speed-distance beyond TRACK_LENGTH; trailing car stops there).
 */
function simulateWinner(track, rng) {
  const positions = track.lanes.map(() => 0);
  const speeds    = track.lanes.map(() => 0);
  const hitFlags  = track.lanes.map(() => false);
  let tick = 0;

  while (positions.some((p) => p < track.length) && tick < MAX_TICKS) {
    track.lanes.forEach((lane, i) => {
      if (positions[i] >= track.length) { speeds[i] = 0; hitFlags[i] = false; return; }
      const onPothole = lane.potholes.some((p) => Math.abs(p - positions[i]) < POTHOLE_HIT_RADIUS);
      const jitter = 0.85 + rng() * 0.3;
      const speed = BASE_SPEED * (onPothole ? POTHOLE_PENALTY : 1) * jitter;
      positions[i] += speed;
      speeds[i] = speed;
      hitFlags[i] = onPothole;
    });
    tick++;
  }

  // Whoever has the higher final position crossed first (or went furthest in MAX_TICKS)
  let winnerIdx = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] > positions[winnerIdx]) winnerIdx = i;
  }
  return winnerIdx;
}

const router = Router();

// ───── GET /api/lobbies ─ list open lobbies ──────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT l.id,
             l.stake::text,
             l.min_players AS "minPlayers",
             l.max_players AS "maxPlayers",
             l.creator,
             l.status,
             COUNT(lp.address)::int AS players,
             COALESCE(
               json_agg(json_build_object('address', lp.address, 'joinedAt', lp.joined_at))
               FILTER (WHERE lp.address IS NOT NULL),
               '[]'::json
             ) AS member_list,
             l.created_at
        FROM lobbies l
        LEFT JOIN lobby_players lp ON lp.lobby_id = l.id
       WHERE l.status = 'open'
       GROUP BY l.id
       ORDER BY l.created_at DESC
       LIMIT 100
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// ───── POST /api/lobbies ─ create a lobby ────────────────────────────────
//   Body: { stake, creator, minPlayers?, maxPlayers? }
//     2 <= minPlayers <= maxPlayers <= 5
router.post('/', async (req, res, next) => {
  try {
    const { stake, creator, username } = req.body;
    if (!stake || !creator) {
      return res.status(400).json({ error: 'stake and creator required' });
    }

    const minPlayers = clampInt(req.body.minPlayers, 2, 5, 2);
    const maxPlayers = clampInt(req.body.maxPlayers, minPlayers, 5, 5);

    // Upsert player — update username whenever one is provided
    await query(
      `INSERT INTO players (address, username) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE SET username = COALESCE(EXCLUDED.username, players.username)`,
      [creator, username || null],
    );

    const { rows } = await query(
      `INSERT INTO lobbies (stake, creator, min_players, max_players)
       VALUES ($1, $2, $3, $4)
       RETURNING id, stake::text, creator, min_players AS "minPlayers",
                 max_players AS "maxPlayers", status, created_at`,
      [stake, creator, minPlayers, maxPlayers],
    );
    const lobby = rows[0];

    // Creator implicitly joins their own lobby
    await query(
      `INSERT INTO lobby_players (lobby_id, address, username) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [lobby.id, creator, username || null],
    );

    res.status(201).json(lobby);
  } catch (e) { next(e); }
});

// ───── POST /api/lobbies/:id/join ────────────────────────────────────────
router.post('/:id/join', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address, username } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    // Upsert player — update username whenever one is provided
    await query(
      `INSERT INTO players (address, username) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE SET username = COALESCE(EXCLUDED.username, players.username)`,
      [address, username || null],
    );

    const lobby = await query(`SELECT * FROM lobbies WHERE id = $1`, [id]);
    if (lobby.rowCount === 0) return res.status(404).json({ error: 'unknown lobby' });
    const L = lobby.rows[0];
    if (L.status !== 'open') {
      return res.status(409).json({ error: 'lobby not open' });
    }

    const count = await query(
      `SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1`,
      [id],
    );
    if (count.rows[0].n >= L.max_players) {
      return res.status(409).json({ error: 'lobby full' });
    }

    await query(
      `INSERT INTO lobby_players (lobby_id, address, username) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, address, username || null],
    );

    // Recount after insert. If we're now at >= min_players (or full), auto-start.
    const after = await query(
      `SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1`,
      [id],
    );
    const memberCount = after.rows[0].n;
    console.log(`[join] lobby=${id} memberCount=${memberCount} min_players=${L.min_players} max_players=${L.max_players}`);

    let race = null;
    if (memberCount >= L.min_players) {
      console.log(`[join] threshold reached — calling autoStartRace`);
      race = await autoStartRace(L, memberCount);
      console.log(`[join] autoStartRace returned race=${race ? race.id : null}`);
    } else {
      console.log(`[join] threshold not yet reached (${memberCount}/${L.min_players})`);
    }

    res.json({ ok: true, players: memberCount, raceStarted: Boolean(race), race });
  } catch (e) { next(e); }
});

// ───── DELETE /api/lobbies/:id ─ creator cancels before match ────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address } = req.body || {};
    const result = await query(
      `UPDATE lobbies
          SET status = 'cancelled', closed_at = now()
        WHERE id = $1 AND status = 'open' AND creator = $2
        RETURNING id`,
      [id, address],
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'cannot cancel (not creator, or already matched)' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(hi, Math.max(lo, n));
  return def;
}

/**
 * Auto-start a race for a filled lobby. Idempotent: if a race already exists
 * for this lobby, returns it without creating another. The race row's `id`
 * is set equal to the lobby id so the frontend can navigate /race/:lobbyId.
 *
 * The 2-player races table is used by selecting the first two joiners as
 * player1/player2. The combined_seed is generated server-side (random 256-bit
 * hex). winner is picked deterministically from the seed.
 *
 * TODO: extend the races schema to a join table so >2 players can race
 * together. For now, with min_players >= 2 we always have at least two.
 */
async function autoStartRace(lobby, _memberCount) {
  console.log(`[autoStartRace] lobby=${lobby.id} memberCount=${_memberCount}`);

  // Re-entrancy guard: if a race row already exists, return it.
  const existing = await query(`SELECT * FROM races WHERE lobby_id = $1`, [lobby.id]);
  if (existing.rowCount > 0) {
    console.log(`[autoStartRace] race already exists: ${existing.rows[0].id}`);
    return existing.rows[0];
  }

  // Pick the first two joiners (by joined_at) as player1/player2
  const members = await query(
    `SELECT address FROM lobby_players WHERE lobby_id = $1
      ORDER BY joined_at ASC LIMIT 2`,
    [lobby.id],
  );
  console.log(`[autoStartRace] members found: ${members.rowCount}`);
  if (members.rowCount < 2) {
    console.error(`[autoStartRace] not enough members (${members.rowCount}) — aborting`);
    return null;
  }

  const [p1, p2] = [members.rows[0].address, members.rows[1].address];
  console.log(`[autoStartRace] p1=${p1} p2=${p2}`);

  // Generate combined_seed as random 256-bit hex
  const combinedSeed = '0x' + crypto.randomBytes(32).toString('hex');

  // Pick winner by running the same deterministic physics simulation the
  // frontend replay uses.  This guarantees the visual result always matches
  // the declared winner — no parity-bit shortcut that could produce the wrong answer.
  const rng   = createRng(seedFromHex(combinedSeed));
  const track = buildTrack(rng, 2);
  const winnerIdx = simulateWinner(track, rng);
  const players = [p1, p2];
  const winner  = players[winnerIdx];
  const loser   = players[1 - winnerIdx];
  console.log(`[autoStartRace] simulation winner: idx=${winnerIdx} addr=${winner}`);

  // Pot = stake * memberCount (in nano-LADA, BigInt-safe via string math)
  const stake = BigInt(lobby.stake);
  const pot   = stake * BigInt(_memberCount);
  const houseFee = (pot * 500n) / 10000n;       // 5%
  const winnerPayout = pot - houseFee;

  // Use epoch-milliseconds as the on_chain_id (numeric ID for the escrow call).
  // This is unique enough for our purposes since races are created serially.
  const onChainId = BigInt(Date.now());

  console.log(`[autoStartRace] inserting race with state=active winner=${winner} on_chain_id=${onChainId}`);
  let inserted;
  try {
    // Insert the race with id = lobby.id (so /race/:lobbyId resolves)
    inserted = await query(
      `INSERT INTO races (
         id, lobby_id, on_chain_id, player1, player2, stake, pot, state,
         winner, loser, combined_seed,
         winner_payout, house_fee, finished_at
       ) VALUES (
         $1, $1, $2, $3, $4, $5, $6, 'active',
         $7, $8, $9,
         $10, $11, now()
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        lobby.id, onChainId.toString(), p1, p2,
        stake.toString(), pot.toString(),
        winner, loser, combinedSeed,
        winnerPayout.toString(), houseFee.toString(),
      ],
    );
    console.log(`[autoStartRace] INSERT returned ${inserted.rowCount} row(s)`);
  } catch (e) {
    console.error(`[autoStartRace] INSERT failed:`, e.message);
    throw e;
  }

  // Mark the lobby matched
  await query(
    `UPDATE lobbies SET status = 'matched', closed_at = now()
      WHERE id = $1`,
    [lobby.id],
  );

  const row = inserted.rows[0] || (await query(`SELECT * FROM races WHERE id = $1`, [lobby.id])).rows[0];
  console.log(`[autoStartRace] done, race.id=${row?.id} state=${row?.state}`);

  // Register the race on-chain so the escrow contract knows the raceId,
  // stake, and players before deposits arrive.  Fire-and-forget; errors logged.
  createRaceOnChain({
    raceId:  onChainId.toString(),
    stake:   stake.toString(),
    player1: p1,
    player2: p2,
  }).catch((err) => {
    console.error(`[autoStartRace] createRaceOnChain FAILED for race ${row?.id}:`, err.message);
  });

  return row;
}

export default router;
