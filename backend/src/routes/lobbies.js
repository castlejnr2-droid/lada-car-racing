import { randomInt } from 'crypto';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { createRaceOnChain, setPlayer2OnChain, refundRace } from '../services/housePayout.js';
import { config } from '../config.js';

const router = Router();

// ───── GET /api/lobbies ─ list open lobbies ──────────────────────────────
// Only returns lobbies with status='open' (host deposit confirmed on-chain).
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT l.id,
             l.stake::text,
             l.min_players AS "minPlayers",
             l.max_players AS "maxPlayers",
             l.creator,
             l.status,
             COUNT(lp.address)::int AS players,
             COALESCE(
               json_agg(json_build_object('address', lp.address, 'joinedAt', lp.joined_at))
               FILTER (WHERE lp.address IS NOT NULL),
               '[]'::json
             ) AS member_list,
             l.created_at
        FROM lobbies l
        LEFT JOIN lobby_players lp ON lp.lobby_id = l.id
       WHERE l.status = 'open'
       GROUP BY l.id
       ORDER BY l.created_at DESC
       LIMIT 100
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// ───── POST /api/lobbies ─ create a lobby ────────────────────────────────
//
//   Body: { stake, creator, username?, minPlayers?, maxPlayers? }
router.post('/', async (req, res, next) => {
  try {
    const { stake, creator, username } = req.body;
    if (!stake || !creator) {
      return res.status(400).json({ error: 'stake and creator required' });
    }

    const minPlayers = clampInt(req.body.minPlayers, 2, 5, 2);
    const maxPlayers = clampInt(req.body.maxPlayers, minPlayers, 5, 5);

    // Upsert player
    await query(
      `INSERT INTO players (address, username) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE SET username = COALESCE(EXCLUDED.username, players.username)`,
      [creator, username || null],
    );

    const { rows } = await query(
      `INSERT INTO lobbies (stake, creator, min_players, max_players, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id, stake::text, creator, min_players AS "minPlayers",
                 max_players AS "maxPlayers", status, created_at`,
      [stake, creator, minPlayers, maxPlayers],
    );
    const lobby = rows[0];

    // Creator joins their own lobby
    await query(
      `INSERT INTO lobby_players (lobby_id, address, username) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [lobby.id, creator, username || null],
    );

    // Generate on-chain race ID and create race immediately.
    // player2 = house wallet placeholder; updated via SetPlayer2 when real player2 joins.
    const houseWallet = config.ton.houseWallet;
    if (!houseWallet) {
      return res.status(500).json({ error: 'HOUSE_WALLET_ADDRESS not configured' });
    }

    // Ensure house wallet exists in players table (FK constraint on races.player2)
    await query(
      `INSERT INTO players (address, username) VALUES ($1, 'house')
       ON CONFLICT (address) DO NOTHING`,
      [houseWallet],
    );

    // Random uint32 raceId — fits in every layer of the stack:
    //   contract (map<Int as uint64>), TonCenter runMethod (32-bit stack param),
    //   forwardPayload storeUint(id, 64), DB BIGINT.
    // Date.now() (~1.78 trillion in 2026) overflows uint32 and causes
    // raceOf() to return null, aborting payout.
    const onChainId = BigInt(randomInt(1, 0xFFFFFFFF));
    const stakeBigInt = BigInt(stake);
    const pot = stakeBigInt * 2n;   // for 2-player race

    // Register race on-chain and wait for confirmation before marking the race as
    // ready for deposits.  Without this wait, a player can deposit before the escrow
    // knows about the race, causing it to reject the transfer.
    try {
      await createRaceOnChain({
        raceId: onChainId.toString(),
        stake:   stake,
        player1: creator,
        player2: houseWallet,
      });
      console.log(`[lobbies] CreateRace confirmed for lobby=${lobby.id} onChainId=${onChainId}`);
    } catch (err) {
      console.error(`[lobbies] CreateRace FAILED for lobby=${lobby.id}:`, err.message);
      return res.status(500).json({ error: 'Failed to register race on-chain: ' + err.message });
    }

    // Insert race row only after CreateRace is confirmed so deposits can't race ahead
    const raceInsert = await query(
      `INSERT INTO races (id, lobby_id, on_chain_id, player1, player2, stake, pot, state)
       VALUES ($1, $1, $2, $3, $4, $5, $6, 'awaiting_deposits')
       ON CONFLICT (id) DO NOTHING
       RETURNING id, on_chain_id::text AS on_chain_id, player1, player2, stake::text, pot::text, state`,
      [lobby.id, onChainId.toString(), creator, houseWallet, stake, pot.toString()],
    );
    const race = raceInsert.rows[0];

    console.log(`[lobbies] created lobby=${lobby.id} status=open race.on_chain_id=${onChainId}`);
    res.status(201).json({ ...lobby, race });
  } catch (e) { next(e); }
});

// ───── POST /api/lobbies/:id/join ────────────────────────────────────────
router.post('/:id/join', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address, username } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    // Upsert player
    await query(
      `INSERT INTO players (address, username) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE SET username = COALESCE(EXCLUDED.username, players.username)`,
      [address, username || null],
    );

    const lobbyRes = await query(`SELECT * FROM lobbies WHERE id = $1`, [id]);
    if (lobbyRes.rowCount === 0) return res.status(404).json({ error: 'unknown lobby' });
    const L = lobbyRes.rows[0];

    if (L.status !== 'open') {
      return res.status(409).json({ error: 'lobby not open' });
    }

    // Look up the race row
    const raceRes = await query(
      `SELECT id, on_chain_id::text AS on_chain_id, player1, player2, stake::text, pot::text, state
         FROM races WHERE lobby_id = $1`,
      [id],
    );
    if (raceRes.rowCount === 0) return res.status(404).json({ error: 'race not found for lobby' });
    const race = raceRes.rows[0];

    if (race.player1 === address) {
      return res.status(409).json({ error: 'you are already the host' });
    }

    // Register player2 in lobby_players
    await query(
      `INSERT INTO lobby_players (lobby_id, address, username) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, address, username || null],
    );

    // Update race: replace house-wallet placeholder with real player2
    await query(
      `UPDATE races SET player2 = $2 WHERE id = $1`,
      [race.id, address],
    );

    // Close lobby so no more joins
    await query(
      `UPDATE lobbies SET status = 'matched', closed_at = now() WHERE id = $1`,
      [id],
    );

    // Call SetPlayer2 on-chain and wait for confirmation before responding.
    // Without this wait, player2 can deposit before the escrow knows their address,
    // causing the escrow to reject the transfer (it still sees the house-wallet placeholder).
    try {
      await setPlayer2OnChain({ raceId: race.on_chain_id, player2: address });
      console.log(`[lobbies] SetPlayer2 confirmed for race=${race.id} player2=${address}`);
    } catch (err) {
      console.error(`[lobbies] SetPlayer2 FAILED for race=${race.id}:`, err.message);
      return res.status(500).json({ error: 'Failed to register player2 on-chain: ' + err.message });
    }

    console.log(`[lobbies] joined lobby=${id} player2=${address} race=${race.id}`);
    res.json({ ok: true, raceStarted: true, race: { ...race, player2: address } });
  } catch (e) { next(e); }
});

// ───── DELETE /api/lobbies/:id ─ creator cancels ─────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { address } = req.body || {};

    const result = await query(
      `UPDATE lobbies
          SET status = 'cancelled', closed_at = now()
        WHERE id = $1 AND status IN ('open','pending') AND creator = $2
        RETURNING id`,
      [id, address],
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'cannot cancel (not creator, already matched, or not found)' });
    }

    // Mark the associated race as refunded in DB
    const raceResult = await query(
      `UPDATE races SET state = 'refunded', finished_at = now()
        WHERE lobby_id = $1 AND state = 'awaiting_deposits'
        RETURNING on_chain_id, player1_deposited`,
      [id],
    );
    // Only trigger on-chain refund if the host actually deposited — otherwise
    // there is no LADA in the escrow to return, and calling Refund would just
    // send 0.2 TON to the contract with nothing coming back.
    if (raceResult.rowCount > 0) {
      const { on_chain_id: onChainId, player1_deposited } = raceResult.rows[0];
      if (player1_deposited && onChainId) {
        refundRace({ raceId: onChainId }).catch((err) => {
          console.error(`[lobbies] refundRace FAILED for lobby=${id}:`, err.message);
        });
      }
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(hi, Math.max(lo, n));
  return def;
}

export default router;
