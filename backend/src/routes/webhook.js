import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

/**
 * Called by the indexer when the escrow contract emits an event.
 * Body shape:
 *   { type: 'WinnerDeclared', raceId, winner, combinedSeed, payout, houseFee, txHash }
 */
router.post('/event', async (req, res, next) => {
  try {
    const e = req.body;
    if (e.type === 'WinnerDeclared') {
      await query(
        `UPDATE races
            SET winner = $1, combined_seed = $2, winner_payout = $3,
                house_fee = $4, tx_hash = $5, status = 'settled', finished_at = now()
          WHERE id = $6`,
        [e.winner, e.combinedSeed, e.payout, e.houseFee, e.txHash, e.raceId],
      );
      await query(
        `INSERT INTO house_fees (race_id, amount, tx_hash) VALUES ($1, $2, $3)`,
        [e.raceId, e.houseFee, e.txHash],
      );
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
