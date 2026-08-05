import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { Wallet } from '../types';

export function walletsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/:walletId', (req, res) => {
    const row = db.prepare('SELECT id, balance, currency FROM wallets WHERE id = ?')
      .get(req.params.walletId) as Wallet | undefined;

    if (!row) {
      return res.status(404).json({ error: 'wallet not found' });
    }

    return res.status(200).json(row);
  });

  return router;
}
