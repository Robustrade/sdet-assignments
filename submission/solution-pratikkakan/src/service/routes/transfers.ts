import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import type { Transfer, IdempotencyKey } from '../db';

// Supported currencies — extend as needed
const VALID_CURRENCIES = new Set(['AED', 'USD', 'EUR', 'GBP', 'SAR', 'KWD']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashPayload(payload: object): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createTransfersRouter(db: Database): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    // 1. Idempotency key is mandatory before any other check
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'MISSING_IDEMPOTENCY_KEY' });
    }

    // 2. Body validation
    const { source_wallet_id, destination_wallet_id, amount, currency, reference } = req.body ?? {};

    const missingFields: string[] = [];
    if (!source_wallet_id) missingFields.push('source_wallet_id');
    if (!destination_wallet_id) missingFields.push('destination_wallet_id');
    if (amount === undefined || amount === null) missingFields.push('amount');
    if (!currency) missingFields.push('currency');

    if (missingFields.length > 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: missingFields });
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['amount'] });
    }

    if (!VALID_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['currency'] });
    }

    if (source_wallet_id === destination_wallet_id) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        fields: ['destination_wallet_id'],
        message: 'Source and destination wallet must differ',
      });
    }

    // 3. Idempotency cache check — happens before any DB mutation
    const requestHash = hashPayload({ source_wallet_id, destination_wallet_id, amount, currency, reference: reference ?? null });

    const existingKey = db
      .prepare('SELECT * FROM idempotency_keys WHERE key = ?')
      .get(idempotencyKey) as IdempotencyKey | undefined;

    if (existingKey) {
      if (existingKey.request_hash !== requestHash) {
        return res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' });
      }
      // Replay: always 200 to distinguish a cached response from a freshly created one
      return res.status(200).json(JSON.parse(existingKey.response_body));
    }

    // 4. Execute the transfer inside a serializable transaction
    const result = db.transaction(() => {
      const sourceWallet = db
        .prepare('SELECT id, balance, currency FROM wallets WHERE id = ?')
        .get(source_wallet_id) as { id: string; balance: number; currency: string } | undefined;

      if (!sourceWallet) {
        return { status: 422 as const, body: { error: 'SOURCE_WALLET_NOT_FOUND' } };
      }

      if (!db.prepare('SELECT id FROM wallets WHERE id = ?').get(destination_wallet_id)) {
        return { status: 422 as const, body: { error: 'DESTINATION_WALLET_NOT_FOUND' } };
      }

      if (sourceWallet.balance < amount) {
        return { status: 422 as const, body: { error: 'INSUFFICIENT_BALANCE' } };
      }

      // Atomic debit / credit
      db.prepare('UPDATE wallets SET balance = balance - ? WHERE id = ?').run(amount, source_wallet_id);
      db.prepare('UPDATE wallets SET balance = balance + ? WHERE id = ?').run(amount, destination_wallet_id);

      const transferId = uuidv4();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO transfers
          (id, source_wallet_id, destination_wallet_id, amount, currency, status, reference, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)
      `).run(transferId, source_wallet_id, destination_wallet_id, amount, currency, reference ?? null, idempotencyKey, now, now);

      // Audit trail: two events mark the full lifecycle
      const insertEvent = db.prepare(
        'INSERT INTO transfer_events (id, transfer_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      insertEvent.run(uuidv4(), transferId, 'TRANSFER_INITIATED', JSON.stringify({ amount, currency }), now);
      insertEvent.run(uuidv4(), transferId, 'TRANSFER_COMPLETED', JSON.stringify({ amount, currency }), now);

      // Outbox event (published=0 = pending; a real publisher would flip this)
      db.prepare(
        'INSERT INTO outbox_events (id, transfer_id, event_type, published, created_at) VALUES (?, ?, ?, 0, ?)',
      ).run(uuidv4(), transferId, 'TRANSFER_COMPLETED', now);

      const transfer = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId) as Transfer;

      const responseBody = {
        id: transfer.id,
        source_wallet_id: transfer.source_wallet_id,
        destination_wallet_id: transfer.destination_wallet_id,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        reference: transfer.reference,
        idempotency_key: transfer.idempotency_key,
        created_at: transfer.created_at,
        updated_at: transfer.updated_at,
      };

      // Cache idempotency record so replays return the same response
      db.prepare(`
        INSERT INTO idempotency_keys (key, transfer_id, request_hash, response_status, response_body, created_at)
        VALUES (?, ?, ?, 201, ?, ?)
      `).run(idempotencyKey, transferId, requestHash, JSON.stringify(responseBody), now);

      return { status: 201 as const, body: responseBody };
    })();

    return res.status(result.status).json(result.body);
  });

  router.get('/:id', (req: Request, res: Response) => {
    const transfer = db
      .prepare('SELECT * FROM transfers WHERE id = ?')
      .get(req.params.id) as Transfer | undefined;

    if (!transfer) {
      return res.status(404).json({ error: 'TRANSFER_NOT_FOUND' });
    }
    return res.json(transfer);
  });

  return router;
}
