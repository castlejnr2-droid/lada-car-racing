import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// ───── GET /api/races ─ list with filters ────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { state, player, limit } = req.query;
    const filters = [];
    const params = [];
    if (state) {
      params.push(state);
      filters.push(`state = $${params.length}`);
    }
    if (player) {
      params.push(player);
      filters.push(`(player1 = $${params.length} OR player2 = $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const cap = Math.min(parseInt(limit || '50', 10), 200);
    params.push(cap);

    const { rows } = await query(
      `SELECT id, on_chain_id, lobby_id, player1, player2,
              stake::text, pot::text, state, winner, loser,
              combined_seed, winner_payout::text, house_fee::text,
              settle_tx_hash, created_at, finished_at
         FROM races
         ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ───── GET /api/races/:id ─ status of a single race ──────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const race = await query(
      `SELECT r.*,
              p1.username AS player1_username,
              p2.username AS player2_username
         FROM races r
         LEFT JOIN players p1 ON p1.address = r.player1
         LEFT JOIN players p2 ON p2.address = r.player2
        WHERE r.id = $1`,
      [id],
    );
    if (race.rowCount === 0) return res.status(404).json({ error: 'unknown race' });

    const row = race.rows[0];
    // Derive winner_username for convenience
    const winner_username = row.winner === row.player1
      ? row.player1_username
      : row.player2_username;

    // include the most recent tx events for this race
    const txs = await query(
      `SELECT type, player, amount::text, tx_hash, observed_at
         FROM transactions
        WHERE race_id = $1
        ORDER BY observed_at DESC
        LIMIT 50`,
      [id],
    );

    res.json({ ...row, winner_username, transactions: txs.rows });
  } catch (e) { next(e); }
});

// ───── GET /api/races/by-chain/:onChainId ────────────────────────────────
router.get('/by-chain/:onChainId', async (req, res, next) => {
  try {
    const { onChainId } = req.params;
    const { rows } = await query(
      `SELECT * FROM races WHERE on_chain_id = $1`,
      [onChainId],
    );
    if (!rows.length) return res.status(404).json({ error: 'unknown race' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ───── GET /api/races/:id/history ─ event log ────────────────────────────
router.get('/:id/history', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT type, player, amount::text, tx_hash, lt, raw, observed_at
         FROM transactions
        WHERE race_id = $1
        ORDER BY observed_at ASC`,
      [id],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
