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

app.listen(config.port, () => {
  console.log(`[lada-backend] listening on :${config.port}`);
  startIndexer().catch((e) => console.error('[indexer] failed to start', e));
});
