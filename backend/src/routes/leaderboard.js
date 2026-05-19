import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.address,
             p.username,
             COUNT(r.id)::int AS wins,
             COALESCE(SUM(r.winner_payout), 0)::text AS "totalWon"
        FROM players p
        LEFT JOIN races r ON r.winner = p.address AND r.status = 'settled'
       GROUP BY p.address, p.username
       ORDER BY wins DESC, "totalWon" DESC
       LIMIT 100
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
