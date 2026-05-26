import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import { startIndexer } from './services/indexer.js';
import { applyMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, env: config.env }));

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

async function registerBotWebhook() {
  const { botToken, webhookUrl, webhookSecret } = config.telegram;
  if (!botToken || !webhookUrl) return;
  const body = { url: webhookUrl };
  if (webhookSecret) body.secret_token = webhookSecret;
  const res  = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.ok) {
    console.log(`[bot] webhook registered → ${webhookUrl}`);
  } else {
    console.warn('[bot] setWebhook failed:', json.description);
  }
}

async function boot() {
  // Run schema migrations before accepting traffic. Migrations are idempotent
  // (CREATE TABLE IF NOT EXISTS) so this is safe on every boot.
  try {
    await applyMigrations();
  } catch (e) {
    console.error('[boot] migration failed — refusing to start server:', e?.message || e);
    console.error(e?.stack || '');
    process.exit(1);
  }

  // Additive column patches — run as individual queries so they always execute
  // even if schema.sql's multi-statement batch aborted early on Railway.
  try {
    await pool.query(`ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS min_players INT NOT NULL DEFAULT 2`);
    await pool.query(`ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS max_players INT NOT NULL DEFAULT 5`);
    await pool.query(`ALTER TABLE races ADD COLUMN IF NOT EXISTS combined_seed TEXT`);
    // Migrate legacy commit-reveal states to 'refunded' before enforcing the
    // new simplified constraint. Races stuck in awaiting_commits / awaiting_reveals
    // / active from the old flow are treated as cancelled/refunded.
    await pool.query(`
      UPDATE races
         SET state = 'refunded'
       WHERE state NOT IN ('awaiting_deposits', 'settled', 'refunded')
    `);
    await pool.query(`ALTER TABLE races DROP CONSTRAINT IF EXISTS races_state_chk`);
    await pool.query(`ALTER TABLE races ADD CONSTRAINT races_state_chk CHECK (state IN (
      'awaiting_deposits','settled','refunded'
    ))`);
    await pool.query(`ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS username TEXT`);
    // Add 'pending' lobby status (hidden until host deposit confirmed)
    await pool.query(`ALTER TABLE lobbies DROP CONSTRAINT IF EXISTS lobbies_status_chk`);
    await pool.query(`ALTER TABLE lobbies ADD CONSTRAINT lobbies_status_chk CHECK (status IN (
      'open','matched','cancelled','pending'
    ))`);
    console.log('[boot] ✓ column patches applied');
  } catch (e) {
    console.error('[boot] column patch failed:', e?.message || e);
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    console.log(`[lada-backend] listening on ${HOST}:${PORT}  (env PORT=${process.env.PORT || 'unset'})`);
    // Indexer runs in-process for the MVP. Fire-and-forget; it polls TonAPI.
    startIndexer().catch((e) => console.error('[indexer] failed to start', e));
    // Register Telegram webhook if both token and target URL are configured.
    registerBotWebhook().catch((e) => console.error('[bot] webhook registration failed', e));
  });
}

boot().catch((e) => {
  console.error('[boot] unhandled error:', e);
  process.exit(1);
});
