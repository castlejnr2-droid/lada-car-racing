import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';

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
    const { stake, creator } = req.body;
    if (!stake || !creator) {
      return res.status(400).json({ error: 'stake and creator required' });
    }

    const minPlayers = clampInt(req.body.minPlayers, 2, 5, 2);
    const maxPlayers = clampInt(req.body.maxPlayers, minPlayers, 5, 5);

    // Make sure the creator exists as a player
    await query(
      `INSERT INTO players (address) VALUES ($1) ON CONFLICT DO NOTHING`,
      [creator],
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
      `INSERT INTO lobby_players (lobby_id, address) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [lobby.id, creator],
    );

    res.status(201).json(lobby);
  } catch (e) { next(e); }
});

// ───── POST /api/lobbies/:id/join ────────────────────────────────────────
router.post('/:id/join', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    await query(
      `INSERT INTO players (address) VALUES ($1) ON CONFLICT DO NOTHING`,
      [address],
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
      `INSERT INTO lobby_players (lobby_id, address) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, address],
    );

    // Recount after insert. If we're now at >= min_players (or full), auto-start.
    const after = await query(
      `SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1`,
      [id],
    );
    const memberCount = after.rows[0].n;

    let race = null;
    if (memberCount >= L.min_players) {
      race = await autoStartRace(L, memberCount);
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
  // Re-entrancy guard: if a race row already exists, return it.
  const existing = await query(`SELECT * FROM races WHERE id = $1`, [lobby.id]);
  if (existing.rowCount > 0) return existing.rows[0];

  // Pick the first two joiners (by joined_at) as player1/player2
  const members = await query(
    `SELECT address FROM lobby_players WHERE lobby_id = $1
      ORDER BY joined_at ASC LIMIT 2`,
    [lobby.id],
  );
  if (members.rowCount < 2) return null;       // shouldn't happen given min_players>=2

  const [p1, p2] = [members.rows[0].address, members.rows[1].address];

  // Generate combined_seed as random 256-bit hex
  const combinedSeed = '0x' + crypto.randomBytes(32).toString('hex');

  // Pick winner: parity bit of the seed
  const winnerIsP2 = (BigInt(combinedSeed) & 1n) === 1n;
  const winner = winnerIsP2 ? p2 : p1;
  const loser  = winnerIsP2 ? p1 : p2;

  // Pot = stake * memberCount (in nano-LADA, BigInt-safe via string math)
  const stake = BigInt(lobby.stake);
  const pot   = stake * BigInt(_memberCount);
  const houseFee = (pot * 500n) / 10000n;       // 5%
  const winnerPayout = pot - houseFee;

  // Insert the race with id = lobby.id (so /race/:lobbyId resolves)
  const inserted = await query(
    `INSERT INTO races (
       id, lobby_id, player1, player2, stake, pot, state,
       winner, loser, combined_seed,
       winner_payout, house_fee, finished_at
     ) VALUES (
       $1, $1, $2, $3, $4, $5, 'active',
       $6, $7, $8,
       $9, $10, now()
     )
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      lobby.id, p1, p2,
      stake.toString(), pot.toString(),
      winner, loser, combinedSeed,
      winnerPayout.toString(), houseFee.toString(),
    ],
  );

  // Mark the lobby matched
  await query(
    `UPDATE lobbies SET status = 'matched', closed_at = now()
      WHERE id = $1`,
    [lobby.id],
  );

  return inserted.rows[0] || (await query(`SELECT * FROM races WHERE id = $1`, [lobby.id])).rows[0];
}

export default router;
