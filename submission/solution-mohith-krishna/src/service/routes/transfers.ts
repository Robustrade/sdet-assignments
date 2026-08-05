import { Router } from 'express';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { VALID_CURRENCIES } from '../types';
import type { TransferRequest, Transfer, Wallet } from '../types';

function hashPayload(data: Record<string, unknown>): string {
  const sorted = Object.keys(data).sort().reduce((acc, key) => {
    acc[key] = data[key];
    return acc;
  }, {} as Record<string, unknown>);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export function transfersRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/:transferId', (req, res) => {
    const row = db.prepare(
      `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
              reference, status, idempotency_key, created_at
       FROM transfers WHERE id = ?`
    ).get(req.params.transferId) as Transfer | undefined;

    if (!row) {
      return res.status(404).json({ error: 'transfer not found' });
    }

    return res.status(200).json(row);
  });

  router.post('/', (req, res) => {
    const idempotencyKey: string | undefined = req.headers['idempotency-key'] as string | undefined;
    const data: TransferRequest = req.body || {};

    const required: Array<keyof TransferRequest> = [
      'source_wallet_id',
      'destination_wallet_id',
      'amount',
      'currency',
    ];
    const missing = required.filter(f => data[f] === undefined || data[f] === null);
    if (missing.length > 0) {
      return res.status(422).json({ error: 'missing fields', fields: missing });
    }

    const sourceId = data.source_wallet_id!;
    const destId = data.destination_wallet_id!;
    const currency = data.currency!;
    const reference = data.reference || null;
    let amount = data.amount!;

    if (typeof currency !== 'string' || !VALID_CURRENCIES.has(currency)) {
      return res.status(422).json({ error: 'invalid currency' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(422).json({ error: 'amount must be positive' });
    }
    if (sourceId === destId) {
      return res.status(422).json({ error: 'source and destination must differ' });
    }

    amount = Math.floor(amount);

    const payloadHash = hashPayload({
      source_wallet_id: sourceId,
      destination_wallet_id: destId,
      amount,
      currency,
      reference,
    });

    const executeTransfer = db.transaction(() => {
      if (idempotencyKey) {
        const existing = db.prepare(
          `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                  reference, status, idempotency_key, created_at, payload_hash
           FROM transfers WHERE idempotency_key = ?`
        ).get(idempotencyKey) as (Transfer & { payload_hash: string }) | undefined;

        if (existing) {
          if (existing.payload_hash !== payloadHash) {
            return { status: 409, body: { error: 'idempotency key conflict' } };
          }
          const { payload_hash: _hash, ...result } = existing;
          return { status: 200, body: result };
        }
      }

      const source = db.prepare('SELECT id, balance, currency FROM wallets WHERE id = ?')
        .get(sourceId) as Wallet | undefined;
      const dest = db.prepare('SELECT id FROM wallets WHERE id = ?')
        .get(destId) as { id: string } | undefined;

      if (!source) {
        return { status: 422, body: { error: 'source wallet not found' } };
      }
      if (!dest) {
        return { status: 422, body: { error: 'destination wallet not found' } };
      }
      if (source.currency !== currency) {
        return { status: 422, body: { error: 'currency mismatch' } };
      }
      if (source.balance < amount) {
        return { status: 422, body: { error: 'insufficient balance' } };
      }

      const transferId = uuidv4();
      const now = new Date().toISOString();

      db.prepare('UPDATE wallets SET balance = balance - ? WHERE id = ?')
        .run(amount, sourceId);
      db.prepare('UPDATE wallets SET balance = balance + ? WHERE id = ?')
        .run(amount, destId);

      db.prepare(
        `INSERT INTO transfers
         (id, source_wallet_id, destination_wallet_id, amount, currency,
          reference, status, idempotency_key, payload_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(transferId, sourceId, destId, amount, currency, reference,
            'completed', idempotencyKey || null, payloadHash, now);

      db.prepare(
        `INSERT INTO audit_events (id, transfer_id, event_type, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), transferId, 'transfer_completed',
            JSON.stringify({ amount, currency }), now);

      db.prepare(
        `INSERT INTO outbox_events (id, transfer_id, event_type, payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), transferId, 'transfer_completed',
            JSON.stringify({ transfer_id: transferId, amount, currency, source_wallet_id: sourceId, destination_wallet_id: destId }),
            'pending', now);

      const row = db.prepare(
        `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                reference, status, idempotency_key, created_at
         FROM transfers WHERE id = ?`
      ).get(transferId);

      return { status: 201, body: row };
    });

    const result = executeTransfer();
    return res.status(result.status).json(result.body);
  });

  return router;
}
