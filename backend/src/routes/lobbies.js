import { Router } from 'express';
import { query } from '../db/pool.js';
import { createRaceOnChain } from '../services/housePayout.js';

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
 * Auto-start a race for a filled lobby.
 *
 * Contract lifecycle enforced here:
 *   1. Generate a uint64 on_chain_id
 *   2. Call CreateRace on the escrow — MUST complete before players deposit
 *      so the contract has the race in its map when it receives TokenNotification
 *   3. Insert race row with state='awaiting_deposits'
 *   4. Players then deposit from the Race screen (Race.jsx deposit phase)
 *   5. Contract advances: awaiting_commits → awaiting_reveals → settled (auto)
 *
 * Winner / combined_seed are NOT set here — they come from the on-chain
 * WinnerDeclared event that the indexer picks up after both players reveal.
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

  const stake     = BigInt(lobby.stake);
  const pot       = stake * BigInt(_memberCount);
  const onChainId = BigInt(Date.now());   // uint64 race ID for the escrow contract

  // ── Step 1: register race on the escrow contract ──────────────────────────
  // This MUST succeed before we tell players to deposit; if the escrow doesn't
  // know about the race, it immediately refunds any incoming TokenNotification.
  console.log(`[autoStartRace] calling CreateRace on escrow | on_chain_id=${onChainId}`);
  try {
    await createRaceOnChain({ raceId: onChainId.toString(), stake: stake.toString(), player1: p1, player2: p2 });
    console.log(`[autoStartRace] CreateRace sent successfully`);
  } catch (err) {
    // Log and continue — the race still gets created in the DB so players can
    // see the screen.  If CreateRace failed, deposits will be refunded by the
    // contract; the admin should retry or refund manually.
    console.error(`[autoStartRace] CreateRace FAILED (deposits will be refunded by escrow):`, err.message);
  }

  // ── Step 2: create race row (awaiting_deposits, no winner yet) ────────────
  console.log(`[autoStartRace] inserting race | state=awaiting_deposits | on_chain_id=${onChainId}`);
  let inserted;
  try {
    inserted = await query(
      `INSERT INTO races (id, lobby_id, on_chain_id, player1, player2, stake, pot, state)
       VALUES ($1, $1, $2, $3, $4, $5, $6, 'awaiting_deposits')
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [lobby.id, onChainId.toString(), p1, p2, stake.toString(), pot.toString()],
    );
    console.log(`[autoStartRace] INSERT returned ${inserted.rowCount} row(s)`);
  } catch (e) {
    console.error(`[autoStartRace] INSERT failed:`, e.message);
    throw e;
  }

  await query(
    `UPDATE lobbies SET status = 'matched', closed_at = now() WHERE id = $1`,
    [lobby.id],
  );

  const row = inserted.rows[0] || (await query(`SELECT * FROM races WHERE id = $1`, [lobby.id])).rows[0];
  console.log(`[autoStartRace] done, race.id=${row?.id} state=${row?.state}`);
  return row;
}

export default router;
