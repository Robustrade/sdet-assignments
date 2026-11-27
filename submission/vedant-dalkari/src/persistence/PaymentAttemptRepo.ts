/**
 * Payment attempt repository backed by SQLite (sql.js).
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import { NotFoundError } from '../domain/errors.js';
import type { PaymentAttemptRecord, PaymentAttemptStatus } from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export interface CreatePaymentAttemptInput {
  readonly id: string;
  readonly invoice_id: string;
  readonly subscription_id: string;
  readonly idempotency_key: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: PaymentAttemptStatus;
  readonly provider_reference: string | null;
  readonly failure_reason: string | null;
  readonly created_at: string;
}

const ATTEMPT_COLUMNS =
  'id, invoice_id, subscription_id, idempotency_key, amount_cents, currency, status, provider_reference, failure_reason, created_at';

export class PaymentAttemptRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public create(input: CreatePaymentAttemptInput): PaymentAttemptRecord {
    this.db.run(
      `INSERT INTO payment_attempts (${ATTEMPT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.invoice_id,
        input.subscription_id,
        input.idempotency_key,
        input.amount_cents,
        input.currency,
        input.status,
        input.provider_reference,
        input.failure_reason,
        input.created_at,
      ],
    );
    const created = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE id = ?`,
      [input.id],
    );
    if (!created) {
      throw new NotFoundError(`PaymentAttempt "${input.id}" not found after insert`);
    }
    return created as unknown as PaymentAttemptRecord;
  }

  public findBySubscriptionId(subscriptionId: string): PaymentAttemptRecord[] {
    const rows = this.db.queryAll<Record<string, SqlValue>>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE subscription_id = ? ORDER BY rowid ASC`,
      [subscriptionId],
    );
    return rows as unknown as PaymentAttemptRecord[];
  }

  public hasSucceededAttempt(subscriptionId: string): boolean {
    const row = this.db.queryOne<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM payment_attempts WHERE subscription_id = ? AND status = 'succeeded'",
      [subscriptionId],
    );
    return Number(row?.cnt ?? 0) > 0;
  }
}
