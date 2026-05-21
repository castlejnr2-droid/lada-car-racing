import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_TABLES = [
  'players', 'lobbies', 'lobby_players',
  'races', 'transactions', 'house_fees',
];

/**
 * Apply schema.sql against the connected database and verify all expected
 * tables exist afterwards. Idempotent: safe to call on every boot because
 * schema.sql is built entirely from `CREATE TABLE IF NOT EXISTS …` etc.
 *
 * Throws on failure so the caller can decide whether to crash the process.
 */
export async function applyMigrations() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not set');
  console.log('[migrate] connecting to', url.replace(/:[^:@]+@/, ':***@'));

  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] applying schema.sql (', sql.length, 'bytes )');
  await pool.query(sql);

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const present = rows.map((r) => r.table_name);
  console.log('[migrate] tables now in DB:', present.join(', '));

  const missing = EXPECTED_TABLES.filter((t) => !present.includes(t));
  if (missing.length) {
    throw new Error(`migration ran but tables missing: ${missing.join(', ')}`);
  }
  console.log('[migrate] ✓ all expected tables present');
}

// CLI invocation: `node src/db/migrate.js` — runs migrations then closes the pool.
// Detect "am I the entrypoint" by comparing import.meta.url to argv[1].
const isCLI = import.meta.url === `file://${path.resolve(process.argv[1] || '')}`;
if (isCLI) {
  applyMigrations()
    .then(() => pool.end())
    .catch((e) => {
      console.error('[migrate] ✗ FAILED:', e?.message || e);
      console.error(e?.stack || '');
      process.exit(1);
    });
}
