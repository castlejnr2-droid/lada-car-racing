import { config } from '../config.js';

/**
 * Shared-secret admin check. The token is set in ADMIN_TOKEN and sent in
 * the X-Admin-Token header. Mutating /api/house endpoints use this.
 *
 * In production prefer a real auth flow — this is sufficient for the MVP
 * because the only "admin" caller is the operator manually marking fees
 * as withdrawn after moving them from the house wallet to the treasury.
 */
export function requireAdmin(req, res, next) {
  if (!config.admin.token) {
    return res.status(503).json({ error: 'ADMIN_TOKEN not configured' });
  }
  if (req.header('X-Admin-Token') !== config.admin.token) {
    return res.status(401).json({ error: 'admin token required' });
  }
  next();
}
