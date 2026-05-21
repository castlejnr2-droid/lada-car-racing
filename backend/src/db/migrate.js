import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_TABLES = ['players', 'lobbies', 'lobby_players', 'races', 'transactions', 'house_fees'];

async function main() {
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
  await pool.end();
}

main().catch((e) => {
  console.error('[migrate] ✗ FAILED:', e?.message || e);
  console.error(e?.stack || '');
  process.exit(1);
});
