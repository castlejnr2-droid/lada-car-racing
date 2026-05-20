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

// ───── GET /api/players/:address ─ profile + lifetime stats ──────────────
router.get('/:address', async (req, res, next) => {
  try {
    const { address } = req.params;
    const profile = await query(`SELECT * FROM players WHERE address = $1`, [address]);
    if (profile.rowCount === 0) return res.status(404).json({ error: 'unknown player' });

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

// ───── GET /api/players/:address/balance ─ live Lada jetton balance ──────
router.get('/:address/balance', async (req, res, next) => {
  try {
    const { address } = req.params;
    if (!config.ton.ladaJettonMaster) {
      return res.status(503).json({ error: 'LADA_JETTON_MASTER not configured' });
    }
    const balance = await getJettonBalance(address, config.ton.ladaJettonMaster);
    res.json({ address, balance: balance.toString() });
  } catch (e) { next(e); }
});

// ───── GET /api/players/:address/races ─ race history ────────────────────
router.get('/:address/races', async (req, res, next) => {
  try {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const { rows } = await query(
      `SELECT id, on_chain_id, state, stake, pot, player1, player2,
              winner, winner_payout, house_fee, created_at, finished_at
         FROM races
        WHERE player1 = $1 OR player2 = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [address, limit],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
