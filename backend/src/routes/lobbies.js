import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// ───── GET /api/lobbies ─ list open lobbies ──────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT l.id,
             l.stake::text,
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
router.post('/', async (req, res, next) => {
  try {
    const { stake, creator, maxPlayers } = req.body;
    if (!stake || !creator) {
      return res.status(400).json({ error: 'stake and creator required' });
    }

    // Make sure the creator exists as a player
    await query(
      `INSERT INTO players (address) VALUES ($1) ON CONFLICT DO NOTHING`,
      [creator],
    );

    const { rows } = await query(
      `INSERT INTO lobbies (stake, creator, max_players)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [stake, creator, maxPlayers ?? 2],
    );
    // Creator implicitly joins their own lobby
    await query(
      `INSERT INTO lobby_players (lobby_id, address) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [rows[0].id, creator],
    );

    res.status(201).json(rows[0]);
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
    if (lobby.rows[0].status !== 'open') {
      return res.status(409).json({ error: 'lobby not open' });
    }

    const count = await query(
      `SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1`,
      [id],
    );
    if (count.rows[0].n >= lobby.rows[0].max_players) {
      return res.status(409).json({ error: 'lobby full' });
    }

    await query(
      `INSERT INTO lobby_players (lobby_id, address) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, address],
    );

    // Mark matched if the lobby is full now
    const after = await query(
      `SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1`,
      [id],
    );
    if (after.rows[0].n >= lobby.rows[0].max_players) {
      await query(
        `UPDATE lobbies SET status = 'matched', closed_at = now() WHERE id = $1`,
        [id],
      );
    }

    res.json({ ok: true, players: after.rows[0].n });
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

export default router;
