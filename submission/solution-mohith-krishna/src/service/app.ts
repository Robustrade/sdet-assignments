import express from 'express';
import type Database from 'better-sqlite3';
import { createDatabase, seedWallets } from './db';
import { transfersRouter } from './routes/transfers';
import { walletsRouter } from './routes/wallets';

export interface AppContext {
  app: express.Express;
  db: Database.Database;
}

const DEFAULT_WALLETS = [
  { id: 'wallet_001', balance: 10000, currency: 'AED' },
  { id: 'wallet_002', balance: 5000, currency: 'AED' },
  { id: 'wallet_003', balance: 0, currency: 'AED' },
];

export function createApp(wallets = DEFAULT_WALLETS): AppContext {
  const db = createDatabase(':memory:');
  seedWallets(db, wallets);

  const app = express();
  app.use(express.json());
  app.use('/transfers', transfersRouter(db));
  app.use('/wallets', walletsRouter(db));

  return { app, db };
}
