import pg from 'pg';
import { config } from '../config.js';

// Railway managed Postgres requires SSL. The cert chain is self-signed inside
// their network, so we tell pg to trust it. Locally we leave SSL off unless
// the URL itself enables it.
const isProd = process.env.NODE_ENV === 'production'
  || /railway\.app|render\.com|amazonaws\.com|neon\.tech|supabase\.co/.test(config.databaseUrl || '');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
  // Reasonable defaults for a small Express app
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[pg] idle client error', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.DEBUG_SQL) {
    console.log('[sql]', text, 'in', Date.now() - start, 'ms');
  }
  return res;
}
