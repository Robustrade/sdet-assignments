import type { AttemptStatus, OutcomeSource, PaymentAttempt } from '../../domain/types';
import type { Database } from '../Database';

interface AttemptRow {
  id: string;
  invoice_id: string;
  attempt_number: number;
  idempotency_key: string;
  amount: number;
  status: AttemptStatus;
  provider_charge_id: string | null;
  decline_code: string | null;
  resolved_by: OutcomeSource | null;
  created_at: string;
  resolved_at: string | null;
}

function toAttempt(row: AttemptRow): PaymentAttempt {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    attemptNumber: row.attempt_number,
    idempotencyKey: row.idempotency_key,
    amount: row.amount,
    status: row.status,
    providerChargeId: row.provider_charge_id,
    declineCode: row.decline_code,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export interface AttemptResolution {
  status: 'succeeded' | 'declined';
  providerChargeId: string | null;
  declineCode: string | null;
  resolvedBy: OutcomeSource;
  atIso: string;
}

export class PaymentAttemptRepository {
  constructor(private readonly db: Database) {}

  insert(a: PaymentAttempt): void {
    this.db.run(
      `INSERT INTO payment_attempts (id, invoice_id, attempt_number, idempotency_key, amount, status,
         provider_charge_id, decline_code, resolved_by, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.invoiceId, a.attemptNumber, a.idempotencyKey, a.amount, a.status, a.providerChargeId, a.declineCode, a.resolvedBy, a.createdAt, a.resolvedAt],
    );
  }

  find(id: string): PaymentAttempt | undefined {
    const row = this.db.get<AttemptRow>('SELECT * FROM payment_attempts WHERE id = ?', [id]);
    return row && toAttempt(row);
  }

  /** The attempt still waiting for a definitive outcome (pending or timed out), if any. */
  findUnresolved(invoiceId: string): PaymentAttempt | undefined {
    const row = this.db.get<AttemptRow>(
      `SELECT * FROM payment_attempts WHERE invoice_id = ? AND status IN ('pending', 'timed_out')
       ORDER BY attempt_number DESC LIMIT 1`,
      [invoiceId],
    );
    return row && toAttempt(row);
  }

  nextAttemptNumber(invoiceId: string): number {
    const row = this.db.get<{ n: number }>('SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM payment_attempts WHERE invoice_id = ?', [invoiceId]);
    return row!.n;
  }

  recordProviderChargeId(id: string, chargeId: string): void {
    this.db.run('UPDATE payment_attempts SET provider_charge_id = ? WHERE id = ?', [chargeId, id]);
  }

  markTimedOut(id: string): boolean {
    return this.db.run("UPDATE payment_attempts SET status = 'timed_out' WHERE id = ? AND status = 'pending'", [id]) === 1;
  }

  /** Records a definitive outcome. Returns false if the attempt was already resolved. */
  resolve(id: string, r: AttemptResolution): boolean {
    return (
      this.db.run(
        `UPDATE payment_attempts
         SET status = ?, provider_charge_id = COALESCE(?, provider_charge_id), decline_code = ?, resolved_by = ?, resolved_at = ?
         WHERE id = ? AND status IN ('pending', 'timed_out')`,
        [r.status, r.providerChargeId, r.declineCode, r.resolvedBy, r.atIso, id],
      ) === 1
    );
  }
}
