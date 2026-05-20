import { Router } from 'express';
import lobbiesRouter from './lobbies.js';
import racesRouter from './races.js';
import playersRouter from './players.js';
import leaderboardRouter from './leaderboard.js';
import houseRouter from './house.js';
import webhookRouter from './webhook.js';

const router = Router();

router.use('/lobbies',     lobbiesRouter);
router.use('/races',       racesRouter);
router.use('/players',     playersRouter);
router.use('/leaderboard', leaderboardRouter);
router.use('/house',       houseRouter);
router.use('/webhook',     webhookRouter);

export default router;
