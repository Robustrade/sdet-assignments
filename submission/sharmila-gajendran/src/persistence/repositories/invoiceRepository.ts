import { NotFoundError, StaleStateError } from '../../domain/errors';
import type { Invoice, InvoiceStatus } from '../../domain/types';
import type { Db } from '../database';

interface InvoiceRow {
  id: string;
  subscription_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  idempotency_key: string;
  provider_charge_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as InvoiceStatus,
    idempotencyKey: row.idempotency_key,
    providerChargeId: row.provider_charge_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewInvoice {
  readonly id: string;
  readonly subscriptionId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly createdAt: string;
}

export class InvoiceRepository {
  constructor(private readonly db: Db) {}

  /** Every billing attempt starts as a pending invoice. Its id doubles as the idempotency key. */
  insertPending(invoice: NewInvoice): void {
    this.db
      .prepare(
        `INSERT INTO invoices
           (id, subscription_id, amount_cents, currency, status, idempotency_key, provider_charge_id, failure_reason, created_at, updated_at)
         VALUES
           (@id, @subscriptionId, @amountCents, @currency, 'pending', @id, NULL, NULL, @createdAt, @createdAt)`,
      )
      .run({
        id: invoice.id,
        subscriptionId: invoice.subscriptionId,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        createdAt: invoice.createdAt,
      });
  }

  findById(id: string): Invoice | undefined {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = @id').get({ id }) as InvoiceRow | undefined;
    return row ? toInvoice(row) : undefined;
  }

  getById(id: string): Invoice {
    const invoice = this.findById(id);
    if (!invoice) {
      throw new NotFoundError(`Invoice '${id}' does not exist`, 'INVOICE_NOT_FOUND');
    }
    return invoice;
  }

  /** Oldest first. */
  findBySubscription(subscriptionId: string): Invoice[] {
    const rows = this.db
      .prepare('SELECT * FROM invoices WHERE subscription_id = @subscriptionId ORDER BY rowid')
      .all({ subscriptionId }) as InvoiceRow[];
    return rows.map(toInvoice);
  }

  findPendingBySubscription(subscriptionId: string): Invoice | undefined {
    const row = this.db
      .prepare("SELECT * FROM invoices WHERE subscription_id = @subscriptionId AND status = 'pending' ORDER BY rowid LIMIT 1")
      .get({ subscriptionId }) as InvoiceRow | undefined;
    return row ? toInvoice(row) : undefined;
  }

  findAll(): Invoice[] {
    const rows = this.db.prepare('SELECT * FROM invoices ORDER BY rowid').all() as InvoiceRow[];
    return rows.map(toInvoice);
  }

  /** Failed attempts since the last successful one. Used to decide when retries are exhausted. */
  countConsecutiveFailures(subscriptionId: string): number {
    let failures = 0;
    for (const invoice of this.findBySubscription(subscriptionId).reverse()) {
      if (invoice.status === 'failed') {
        failures += 1;
      } else if (invoice.status === 'paid' || invoice.status === 'refunded') {
        break;
      }
    }
    return failures;
  }

  markPaid(id: string, providerChargeId: string | null, updatedAt: string): void {
    this.settlePending(id, 'paid', providerChargeId, null, updatedAt);
  }

  markFailed(id: string, providerChargeId: string | null, reason: string, updatedAt: string): void {
    this.settlePending(id, 'failed', providerChargeId, reason, updatedAt);
  }

  /** The provider accepted the charge; the result will come by webhook. */
  recordProviderCharge(id: string, providerChargeId: string, updatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE invoices SET provider_charge_id = @providerChargeId, updated_at = @updatedAt
          WHERE id = @id AND status = 'pending'`,
      )
      .run({ id, providerChargeId, updatedAt });
    this.expectOneRow(result.changes, id);
  }

  markRefunded(id: string, updatedAt: string): void {
    const result = this.db
      .prepare("UPDATE invoices SET status = 'refunded', updated_at = @updatedAt WHERE id = @id AND status = 'paid'")
      .run({ id, updatedAt });
    this.expectOneRow(result.changes, id);
  }

  /** Only a pending invoice can be settled, and only once. */
  private settlePending(
    id: string,
    status: 'paid' | 'failed',
    providerChargeId: string | null,
    failureReason: string | null,
    updatedAt: string,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE invoices
            SET status = @status,
                provider_charge_id = COALESCE(@providerChargeId, provider_charge_id),
                failure_reason = @failureReason,
                updated_at = @updatedAt
          WHERE id = @id AND status = 'pending'`,
      )
      .run({ id, status, providerChargeId, failureReason, updatedAt });
    this.expectOneRow(result.changes, id);
  }

  private expectOneRow(changes: number, id: string): void {
    if (changes !== 1) {
      throw new StaleStateError('Invoice', id);
    }
  }
}
