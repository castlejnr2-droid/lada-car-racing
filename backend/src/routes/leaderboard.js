import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// ───── GET /api/leaderboard ─ top players by winnings ────────────────────
//   query params:
//     period = all | day | week | month  (default: all)
//     limit  = 1..200                    (default: 100)
router.get('/', async (req, res, next) => {
  try {
    const period = (req.query.period || 'all').toString();
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

    const intervals = {
      day:   `1 day`,
      week:  `7 days`,
      month: `30 days`,
    };
    const where = intervals[period]
      ? `r.state = 'settled' AND r.finished_at > now() - interval '${intervals[period]}'`
      : `r.state = 'settled'`;

    const { rows } = await query(
      `SELECT p.address,
              p.username,
              p.avatar_url AS "avatarUrl",
              COUNT(r.id) FILTER (WHERE r.winner = p.address)::int  AS wins,
              COUNT(r.id) FILTER (WHERE r.loser  = p.address)::int  AS losses,
              COALESCE(SUM(r.winner_payout) FILTER (WHERE r.winner = p.address), 0)::text
                AS "totalWon",
              COALESCE(SUM(r.stake) FILTER (WHERE r.loser = p.address), 0)::text
                AS "totalLost"
         FROM players p
         JOIN races r ON (r.player1 = p.address OR r.player2 = p.address)
                      AND ${where}
        GROUP BY p.address, p.username, p.avatar_url
        HAVING COUNT(r.id) FILTER (WHERE r.winner = p.address) > 0
        ORDER BY wins DESC, "totalWon"::numeric DESC
        LIMIT $1`,
      [limit],
    );
    res.json({ period, rows });
  } catch (e) { next(e); }
});

export default router;
