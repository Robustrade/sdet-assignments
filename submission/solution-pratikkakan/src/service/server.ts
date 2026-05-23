import express from 'express';
import type { Database } from 'better-sqlite3';
import { createTransfersRouter } from './routes/transfers';
import { createWalletsRouter } from './routes/wallets';

export function createApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use('/transfers', createTransfersRouter(db));
  app.use('/wallets', createWalletsRouter(db));
  return app;
}
