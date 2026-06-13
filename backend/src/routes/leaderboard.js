import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// ───── GET /api/leaderboard ─ all-time rankings ───────────────────────────
//   query params:
//     sort  = wins | profit   (default: wins)
//     limit = 1..200          (default: 100)
//
//   Net profit per address = SUM(winner_payout - stake) over won races
//                          - SUM(stake) over lost races
//
//   Starts FROM race-derived addresses (UNION of player1/player2) so every
//   participant appears regardless of whether they have a players-table row.
//   players is LEFT JOINed for optional username/avatar metadata only.
router.get('/', async (req, res, next) => {
  try {
    const sort  = req.query.sort === 'profit' ? 'profit' : 'wins';
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

    const orderBy = sort === 'profit'
      ? `"netProfit"::numeric DESC, wins DESC`
      : `wins DESC, "netProfit"::numeric DESC`;

    const { rows } = await query(
      `WITH race_addresses AS (
         SELECT player1 AS address FROM races WHERE state = 'settled'
         UNION
         SELECT player2 AS address FROM races WHERE state = 'settled'
       )
       SELECT ra.address,
              p.username,
              p.avatar_url AS "avatarUrl",
              COUNT(r.id) FILTER (WHERE r.winner = ra.address)::int  AS wins,
              COUNT(r.id) FILTER (WHERE r.loser  = ra.address)::int  AS losses,
              COALESCE(SUM(r.winner_payout) FILTER (WHERE r.winner = ra.address), 0)::text
                AS "totalWon",
              COALESCE(SUM(r.stake) FILTER (WHERE r.loser = ra.address), 0)::text
                AS "totalLost",
              (
                COALESCE(SUM(r.winner_payout) FILTER (WHERE r.winner = ra.address), 0)
                - COALESCE(SUM(r.stake)        FILTER (WHERE r.winner = ra.address), 0)
                - COALESCE(SUM(r.stake)        FILTER (WHERE r.loser  = ra.address), 0)
              )::text AS "netProfit"
         FROM race_addresses ra
         LEFT JOIN players p ON p.address = ra.address
         JOIN races r ON (r.player1 = ra.address OR r.player2 = ra.address)
                      AND r.state = 'settled'
        GROUP BY ra.address, p.username, p.avatar_url
        HAVING COUNT(r.id) > 0
        ORDER BY ${orderBy}
        LIMIT $1`,
      [limit],
    );
    res.json({ sort, rows });
  } catch (e) { next(e); }
});

export default router;
