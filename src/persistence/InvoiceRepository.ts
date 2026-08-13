import type { Db } from './db.js';
import type { Invoice } from '../domain/types.js';

interface InvoiceRow {
  id: string;
  subscription_id: string;
  invoice_id: string;
  status: string;
  amount: number;
  currency: string;
  provider_ref: string;
  event_id: string;
  created_at: string;
}

function toDomain(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    invoiceId: row.invoice_id,
    status: row.status as 'succeeded' | 'failed',
    amount: row.amount,
    currency: row.currency,
    providerRef: row.provider_ref,
    eventId: row.event_id,
    createdAt: row.created_at,
  };
}

export class InvoiceRepository {
  constructor(private readonly db: Db) {}

  create(invoice: Invoice): void {
    this.db
      .prepare(
        `INSERT INTO invoices (id, subscription_id, invoice_id, status, amount, currency, provider_ref, event_id, created_at)
         VALUES (@id, @subscription_id, @invoice_id, @status, @amount, @currency, @provider_ref, @event_id, @created_at)`,
      )
      .run({
        id: invoice.id,
        subscription_id: invoice.subscriptionId,
        invoice_id: invoice.invoiceId,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.currency,
        provider_ref: invoice.providerRef,
        event_id: invoice.eventId,
        created_at: invoice.createdAt,
      });
  }

  forSubscription(subscriptionId: string): Invoice[] {
    const rows = this.db
      .prepare('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at ASC')
      .all(subscriptionId) as InvoiceRow[];
    return rows.map(toDomain);
  }

  hasSucceededFor(invoiceId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM invoices WHERE invoice_id = ? AND status = ?')
      .get(invoiceId, 'succeeded');
    return row !== undefined;
  }

  hasFailedFor(invoiceId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM invoices WHERE invoice_id = ? AND status = ?')
      .get(invoiceId, 'failed');
    return row !== undefined;
  }
}