import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import { startIndexer } from './services/indexer.js';
import { applyMigrations } from './db/migrate.js';

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

  app.listen(PORT, HOST, () => {
    console.log(`[lada-backend] listening on ${HOST}:${PORT}  (env PORT=${process.env.PORT || 'unset'})`);
    // Indexer runs in-process for the MVP. Fire-and-forget; it polls TonAPI.
    startIndexer().catch((e) => console.error('[indexer] failed to start', e));
  });
}

boot().catch((e) => {
  console.error('[boot] unhandled error:', e);
  process.exit(1);
});
