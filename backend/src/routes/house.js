import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { config } from '../config.js';
import { getJettonBalance } from '../services/tonApi.js';

const router = Router();

// ───── GET /api/house/summary ────────────────────────────────────────────
//
// What's tracked here:
//   - collected:  total 5% fees the contract has paid to the house wallet
//   - withdrawn:  total fees the admin has marked as moved out
//   - available:  collected - withdrawn (what's still sitting in the wallet)
//   - liveBalance: actual Lada jetton balance of the house wallet (if known)
router.get('/summary', async (_req, res, next) => {
  try {
    const totals = await query(`
      SELECT
        COALESCE(SUM(amount), 0)::text                              AS collected,
        COALESCE(SUM(amount) FILTER (WHERE withdrawn), 0)::text     AS withdrawn,
        COALESCE(SUM(amount) FILTER (WHERE NOT withdrawn), 0)::text AS available,
        COUNT(*)::int                                               AS race_count,
        COUNT(*) FILTER (WHERE withdrawn)::int                      AS withdrawn_count
      FROM house_fees
    `);

    let liveBalance = null;
    if (config.ton.houseWallet && config.ton.ladaJettonMaster) {
      try {
        const bal = await getJettonBalance(config.ton.houseWallet, config.ton.ladaJettonMaster);
        liveBalance = bal.toString();
      } catch (e) {
        liveBalance = null; // best-effort
      }
    }

    res.json({
      houseWallet: config.ton.houseWallet || null,
      ...totals.rows[0],
      liveBalance,
    });
  } catch (e) { next(e); }
});

// ───── GET /api/house/fees ─ paginated per-race fee list ─────────────────
router.get('/fees', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);
    const withdrawn = req.query.withdrawn;  // undefined | "true" | "false"

    const filters = [];
    const params = [];
    if (withdrawn === 'true' || withdrawn === 'false') {
      params.push(withdrawn === 'true');
      filters.push(`withdrawn = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await query(
      `SELECT id, race_id, amount::text, tx_hash, collected_at,
              withdrawn, withdrawn_at, withdrawal_tx_hash, withdrawal_note
         FROM house_fees
         ${where}
        ORDER BY collected_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ───── POST /api/house/withdraw ─ admin: record a manual withdrawal ──────
//
// The escrow contract already auto-pays 5% to the house wallet on every
// settle. "Withdrawal" here just means moving accumulated jettons OUT of
// the house wallet to ops/treasury. The admin does that via their wallet
// UI, then calls this endpoint to bookkeeep which fees are now off-chain.
//
// Body:
//   { feeIds: [1, 2, 3], destinationAddress, withdrawalTxHash, note }
// or:
//   { upToCollectedAt: "2026-05-19T00:00:00Z", destinationAddress, withdrawalTxHash, note }
router.post('/withdraw', requireAdmin, async (req, res, next) => {
  try {
    const { feeIds, upToCollectedAt, destinationAddress, withdrawalTxHash, note } = req.body;
    if (!destinationAddress || !withdrawalTxHash) {
      return res.status(400).json({
        error: 'destinationAddress and withdrawalTxHash required',
      });
    }

    let result;
    if (Array.isArray(feeIds) && feeIds.length) {
      result = await query(
        `UPDATE house_fees
            SET withdrawn = true,
                withdrawn_at = now(),
                withdrawal_tx_hash = $1,
                withdrawal_note = $2
          WHERE id = ANY($3::bigint[]) AND NOT withdrawn
        RETURNING id, amount::text`,
        [withdrawalTxHash, note ?? null, feeIds],
      );
    } else if (upToCollectedAt) {
      result = await query(
        `UPDATE house_fees
            SET withdrawn = true,
                withdrawn_at = now(),
                withdrawal_tx_hash = $1,
                withdrawal_note = $2
          WHERE collected_at <= $3 AND NOT withdrawn
        RETURNING id, amount::text`,
        [withdrawalTxHash, note ?? null, upToCollectedAt],
      );
    } else {
      return res.status(400).json({
        error: 'either feeIds or upToCollectedAt required',
      });
    }

    const total = result.rows.reduce((s, r) => s + BigInt(r.amount), 0n);
    res.json({
      withdrawn: result.rowCount,
      totalAmount: total.toString(),
      destinationAddress,
      withdrawalTxHash,
    });
  } catch (e) { next(e); }
});

// ───── POST /api/house/cancel-all-pending ─ admin: purge stuck lobbies ──────
//
// Sets all 'pending' and 'open' lobbies to 'cancelled' and their races to
// 'refunded'. Safe to call repeatedly. Useful on boot to clean up test data
// or races that got stuck mid-flow.
router.post('/cancel-all-pending', requireAdmin, async (_req, res, next) => {
  try {
    // Cancel lobbies first (races FK references lobbies)
    const lobbiesResult = await query(`
      UPDATE lobbies
         SET status = 'cancelled', closed_at = COALESCE(closed_at, now())
       WHERE status IN ('pending', 'open')
      RETURNING id
    `);

    const cancelledLobbyIds = lobbiesResult.rows.map(r => r.id);

    let racesUpdated = 0;
    if (cancelledLobbyIds.length > 0) {
      const racesResult = await query(`
        UPDATE races
           SET state = 'refunded', finished_at = COALESCE(finished_at, now())
         WHERE lobby_id = ANY($1::uuid[])
           AND state = 'awaiting_deposits'
        RETURNING id
      `, [cancelledLobbyIds]);
      racesUpdated = racesResult.rowCount;
    }

    console.log(`[house] cancel-all-pending: lobbies=${lobbiesResult.rowCount} races=${racesUpdated}`);
    res.json({
      ok: true,
      lobbiesCancelled: lobbiesResult.rowCount,
      racesRefunded: racesUpdated,
    });
  } catch (e) { next(e); }
});

export default router;
