import { one, type Db } from './database';

export type InvoiceStatus = 'open' | 'paid' | 'failed' | 'refunded';
export type AttemptStatus = 'pending' | 'succeeded' | 'failed';

export interface InvoiceRecord {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
}

export interface AttemptRecord {
  id: string;
  invoiceId: string;
  attemptNo: number;
  idempotencyKey: string;
  status: AttemptStatus;
}

interface InvoiceRow {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
}

interface AttemptRow {
  id: string;
  invoice_id: string;
  attempt_no: number;
  idempotency_key: string;
  status: AttemptStatus;
}

export class BillingRepository {
  constructor(private readonly db: Db) {}

  createInvoice(invoice: { id: string; subscriptionId: string; amount: number; currency: string }, at: Date): InvoiceRecord {
    const ts = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO invoices (id, subscription_id, amount, currency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(invoice.id, invoice.subscriptionId, invoice.amount, invoice.currency, ts, ts);
    return this.findInvoice(invoice.id)!;
  }

  findInvoice(id: string): InvoiceRecord | undefined {
    const row = one<InvoiceRow>(this.db, 'SELECT * FROM invoices WHERE id = ?', id);
    return row && toInvoice(row);
  }

  /** The invoice a past-due retry should charge again. */
  latestUnpaidInvoice(subscriptionId: string): InvoiceRecord | undefined {
    const row = one<InvoiceRow>(
      this.db,
      `SELECT * FROM invoices WHERE subscription_id = ? AND status IN ('open', 'failed')
       ORDER BY rowid DESC LIMIT 1`,
      subscriptionId,
    );
    return row && toInvoice(row);
  }

  setInvoiceStatus(id: string, status: InvoiceStatus, at: Date): void {
    this.db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?').run(status, at.toISOString(), id);
  }

  countAttempts(invoiceId: string): number {
    return one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM payment_attempts WHERE invoice_id = ?', invoiceId)!.n;
  }

  insertPendingAttempt(
    attempt: { id: string; invoiceId: string; attemptNo: number; idempotencyKey: string },
    at: Date,
  ): AttemptRecord {
    const ts = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO payment_attempts (id, invoice_id, attempt_no, idempotency_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(attempt.id, attempt.invoiceId, attempt.attemptNo, attempt.idempotencyKey, ts, ts);
    return { ...attempt, status: 'pending' };
  }

  pendingAttemptForInvoice(invoiceId: string): AttemptRecord | undefined {
    const row = one<AttemptRow>(
      this.db,
      `SELECT * FROM payment_attempts WHERE invoice_id = ? AND status = 'pending'`,
      invoiceId,
    );
    return row && toAttempt(row);
  }

  hasPendingAttempt(subscriptionId: string): boolean {
    return (
      one(
        this.db,
        `SELECT 1 FROM payment_attempts a JOIN invoices i ON i.id = a.invoice_id
         WHERE i.subscription_id = ? AND a.status = 'pending'`,
        subscriptionId,
      ) !== undefined
    );
  }

  /** Resolves a pending attempt exactly once; resolving an already-resolved attempt is a bug. */
  resolveAttempt(
    id: string,
    outcome: { status: 'succeeded' | 'failed'; providerRef: string; declineCode?: string },
    at: Date,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE payment_attempts SET status = ?, provider_ref = ?, decline_code = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(outcome.status, outcome.providerRef, outcome.declineCode ?? null, at.toISOString(), id);
    if (result.changes !== 1) throw new Error(`payment attempt ${id} is not pending`);
  }
}

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return { id: row.id, subscriptionId: row.subscription_id, amount: row.amount, currency: row.currency, status: row.status };
}

function toAttempt(row: AttemptRow): AttemptRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    attemptNo: row.attempt_no,
    idempotencyKey: row.idempotency_key,
    status: row.status,
  };
}
