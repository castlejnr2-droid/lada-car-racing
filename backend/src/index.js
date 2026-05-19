import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import lobbiesRouter from './routes/lobbies.js';
import leaderboardRouter from './routes/leaderboard.js';
import statsRouter from './routes/stats.js';
import webhookRouter from './routes/webhook.js';
import { startIndexer } from './services/indexer.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/lobbies', lobbiesRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/stats', statsRouter);
app.use('/webhook', webhookRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`[lada-backend] listening on :${config.port}`);
  startIndexer().catch((e) => console.error('[indexer] failed to start', e));
});
