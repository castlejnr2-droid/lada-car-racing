import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/player/:address', async (req, res, next) => {
  try {
    const { address } = req.params;
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*) FROM races WHERE winner = $1)::int AS wins,
        (SELECT COUNT(*) FROM lobby_players WHERE address = $1)::int AS races_entered,
        (SELECT COALESCE(SUM(winner_payout), 0)::text FROM races WHERE winner = $1) AS total_won
    `, [address]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.get('/house', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT COALESCE(SUM(amount), 0)::text AS collected, COUNT(*)::int AS races
        FROM house_fees
    `);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
