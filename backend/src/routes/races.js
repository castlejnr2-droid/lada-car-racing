import { Router } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const router = Router();

// ───── GET /api/races ─ list with filters ────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { state, player, limit } = req.query;
    const filters = [];
    const params = [];
    if (state) {
      params.push(state);
      filters.push(`r.state = $${params.length}`);
    }
    if (player) {
      params.push(player);
      filters.push(`(r.player1 = $${params.length} OR r.player2 = $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const cap = Math.min(parseInt(limit || '50', 10), 200);
    params.push(cap);

    const { rows } = await query(
      `SELECT r.id, r.on_chain_id, r.lobby_id, r.player1, r.player2,
              r.stake::text, r.pot::text, r.state, r.winner, r.loser,
              r.combined_seed, r.winner_payout::text, r.house_fee::text,
              r.settle_tx_hash, r.created_at, r.finished_at,
              p1.username AS player1_username,
              p2.username AS player2_username
         FROM races r
         LEFT JOIN players p1 ON p1.address = r.player1
         LEFT JOIN players p2 ON p2.address = r.player2
         ${where}
        ORDER BY r.created_at DESC
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
      `SELECT r.id, r.lobby_id, r.on_chain_id::text, r.player1, r.player2,
              r.stake::text, r.pot::text, r.state, r.winner, r.loser,
              r.combined_seed, r.winner_payout::text, r.house_fee::text,
              r.settle_tx_hash, r.player1_deposited, r.player2_deposited,
              r.created_at, r.finished_at,
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

    // True when player2 is still the house-wallet placeholder (lobby open, waiting for joiner)
    const houseWallet = config.ton.houseWallet;
    const waiting_for_player2 = houseWallet
      ? row.player2 === houseWallet
      : false;

    // include the most recent tx events for this race
    const txs = await query(
      `SELECT type, player, amount::text, tx_hash, observed_at
         FROM transactions
        WHERE race_id = $1
        ORDER BY observed_at DESC
        LIMIT 50`,
      [id],
    );

    res.json({ ...row, winner_username, waiting_for_player2, transactions: txs.rows });
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
