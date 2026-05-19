import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT l.id, l.stake, l.max_players AS "maxPlayers",
             COUNT(lp.address)::int AS players
        FROM lobbies l
        LEFT JOIN lobby_players lp ON lp.lobby_id = l.id
       WHERE l.status = 'open'
       GROUP BY l.id
       ORDER BY l.created_at DESC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { stake, creator } = req.body;
    const { rows } = await query(
      `INSERT INTO lobbies (stake, creator) VALUES ($1, $2) RETURNING *`,
      [stake, creator],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/:id/join', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address } = req.body;
    await query(
      `INSERT INTO lobby_players (lobby_id, address) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, address],
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
