import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { Wallet } from '../db';

export function createWalletsRouter(db: Database): Router {
  const router = Router();

  router.get('/:id', (req: Request, res: Response) => {
    const wallet = db
      .prepare('SELECT * FROM wallets WHERE id = ?')
      .get(req.params.id) as Wallet | undefined;

    if (!wallet) {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND' });
    }
    return res.json(wallet);
  });

  return router;
}
