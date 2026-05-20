import { Router } from 'express';
import { query } from '../db/pool.js';
import { getJettonBalance } from '../services/tonApi.js';
import { config } from '../config.js';

const router = Router();

// ───── POST /api/players ─ upsert (called by the Mini App on connect) ────
router.post('/', async (req, res, next) => {
  try {
    const { address, telegramId, username, avatarUrl } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });
    const { rows } = await query(
      `INSERT INTO players (address, telegram_id, username, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (address) DO UPDATE
         SET telegram_id = EXCLUDED.telegram_id,
             username    = COALESCE(EXCLUDED.username,    players.username),
             avatar_url  = COALESCE(EXCLUDED.avatar_url,  players.avatar_url)
       RETURNING *`,
      [address, telegramId ?? null, username ?? null, avatarUrl ?? null],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ───── GET /api/players/by-telegram/:telegramId ─ lookup for the bot ────
// MUST be declared before /:address so Express doesn't match "by-telegram"
// as an address.
router.get('/by-telegram/:telegramId', async (req, res, next) => {
  try {
    const telegramId = req.params.telegramId;
    const profile = await query(
      `SELECT * FROM players WHERE telegram_id = $1`,
      [telegramId],
    );
    if (profile.rowCount === 0) return res.status(404).json({ error: 'unknown player' });
    const address = profile.rows[0].address;
    const stats = await query(
      `SELECT
         (SELECT COUNT(*) FROM races
            WHERE (player1 = $1 OR player2 = $1) AND state = 'settled')::int AS races_played,
         (SELECT COUNT(*) FROM races WHERE winner = $1)::int                  AS wins,
         (SELECT COUNT(*) FROM races
            WHERE (player1 = $1 OR player2 = $1)
              AND state = 'settled' AND winner <> $1)::int                    AS losses,
         (SELECT COALESCE(SUM(winner_payout), 0)::text FROM races
            WHERE winner = $1)                                                AS total_won,
         (SELECT COALESCE(SUM(stake), 0)::text FROM races
            WHERE (player1 = $1 OR player2 = $1) AND state = 'settled'
              AND winner <> $1)                                               AS total_lost`,
      [address],
    );
    res.json({ ...profile.rows[0], stats: stats.rows[0] });
  } catch (e) { next(e); }
});

export default router;
