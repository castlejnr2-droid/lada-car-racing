import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// ───── GET /api/leaderboard ─ all-time rankings ───────────────────────────
//   query params:
//     sort  = wins | profit   (default: wins)
//     limit = 1..200          (default: 100)
//
//   Net profit per player = SUM(winner_payout - stake) over won races
//                         - SUM(stake) over lost races
//   i.e. what they actually walked away up or down across all settled races.
router.get('/', async (req, res, next) => {
  try {
    const sort  = req.query.sort === 'profit' ? 'profit' : 'wins';
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

    // Dynamic ORDER BY — parameterised values can't be used for column names,
    // but sort is already validated to exactly one of two literals above.
    const orderBy = sort === 'profit'
      ? `"netProfit"::numeric DESC, wins DESC`
      : `wins DESC, "netProfit"::numeric DESC`;

    const { rows } = await query(
      `SELECT p.address,
              p.username,
              p.avatar_url AS "avatarUrl",
              COUNT(r.id) FILTER (WHERE r.winner = p.address)::int  AS wins,
              COUNT(r.id) FILTER (WHERE r.loser  = p.address)::int  AS losses,
              COALESCE(SUM(r.winner_payout) FILTER (WHERE r.winner = p.address), 0)::text
                AS "totalWon",
              COALESCE(SUM(r.stake) FILTER (WHERE r.loser = p.address), 0)::text
                AS "totalLost",
              (
                COALESCE(SUM(r.winner_payout) FILTER (WHERE r.winner = p.address), 0)
                - COALESCE(SUM(r.stake)        FILTER (WHERE r.winner = p.address), 0)
                - COALESCE(SUM(r.stake)        FILTER (WHERE r.loser  = p.address), 0)
              )::text AS "netProfit"
         FROM players p
         JOIN races r ON (r.player1 = p.address OR r.player2 = p.address)
                      AND r.state = 'settled'
        GROUP BY p.address, p.username, p.avatar_url
        HAVING COUNT(r.id) > 0
        ORDER BY ${orderBy}
        LIMIT $1`,
      [limit],
    );
    res.json({ sort, rows });
  } catch (e) { next(e); }
});

export default router;
