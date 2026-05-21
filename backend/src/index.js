import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import apiRouter from './routes/index.js';
import { startIndexer } from './services/indexer.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, env: config.env }));

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// Railway sets PORT — bind to it directly so we can't accidentally read a
// stale config value. Falls back to 3000 locally.
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';   // bind to all interfaces (required inside Railway's container)

app.listen(PORT, HOST, () => {
  console.log(`[lada-backend] listening on ${HOST}:${PORT}  (env PORT=${process.env.PORT || 'unset'})`);
  startIndexer().catch((e) => console.error('[indexer] failed to start', e));
});
