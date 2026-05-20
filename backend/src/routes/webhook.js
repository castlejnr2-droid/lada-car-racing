import { Router } from 'express';
import { handlers } from '../services/events.js';
import { config } from '../config.js';

const router = Router();

// Simple shared-secret check between the indexer and the API.
// The indexer in services/indexer.js runs in-process by default, so this is
// mainly relevant if the indexer is moved to its own process.
function requireIndexerToken(req, res, next) {
  if (!config.admin.token) return next();      // not configured → open in dev
  if (req.header('X-Indexer-Token') !== config.admin.token) {
    return res.status(401).json({ error: 'invalid indexer token' });
  }
  next();
}

/**
 * POST /api/webhook/event
 *
 * Body:
 *   {
 *     type:  'Deposit' | 'Commit' | 'Reveal' | 'WinnerDeclared' | 'RaceRefunded',
 *     txHash, lt, ...event-specific fields
 *   }
 *
 * Event-specific fields (all amounts as decimal strings of nano-LADA):
 *   Deposit:         { raceId, from, amount }
 *   Commit/Reveal:   { raceId, player }
 *   WinnerDeclared:  { raceId, winner, loser, combinedSeed, pot, payout, houseFee }
 *   RaceRefunded:    { raceId, refundAmount }
 */
router.post('/event', requireIndexerToken, async (req, res, next) => {
  try {
    const e = req.body;
    const handler = handlers[e.type];
    if (!handler) {
      return res.status(400).json({ error: `unknown event type: ${e.type}` });
    }
    const result = await handler(e);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/webhook/events
 * Batch variant — accepts an array of events. Processes in order, stops on
 * first failure (the indexer will retry the batch).
 */
router.post('/events', requireIndexerToken, async (req, res, next) => {
  try {
    const events = Array.isArray(req.body) ? req.body : req.body.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'expected array of events' });
    }
    const results = [];
    for (const e of events) {
      const handler = handlers[e.type];
      if (!handler) {
        results.push({ type: e.type, error: 'unknown type' });
        continue;
      }
      results.push({ type: e.type, ...(await handler(e)) });
    }
    res.json({ results });
  } catch (err) { next(err); }
});

export default router;
