
import type BetterSqlite3 from 'better-sqlite3';

export type InvoiceStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded';

export interface Invoice {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  provider_reference: string | null;
  failure_reason: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  created_at: string;
}

export interface CreateInvoiceInput {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status?: InvoiceStatus;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
}

export class InvoiceRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  create(input: CreateInvoiceInput): Invoice {
    this.db.prepare(`
      INSERT INTO invoices (
        id,
        subscription_id,
        amount,
        currency,
        status,
        billing_period_start,
        billing_period_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.subscription_id,
      input.amount,
      input.currency,
      input.status ?? 'pending',
      input.billing_period_start ?? null,
      input.billing_period_end ?? null
    );

    const invoice = this.findById(input.id);

    if (!invoice) {
      throw new Error('Invoice creation failed');
    }

    return invoice;
  }

  findById(id: string): Invoice | null {
    const invoice = this.db.prepare(`
      SELECT *
      FROM invoices
      WHERE id = ?
    `).get(id) as Invoice | undefined;

    return invoice ?? null;
  }

  findBySubscriptionId(subscriptionId: string): Invoice[] {
    return this.db.prepare(`
      SELECT *
      FROM invoices
      WHERE subscription_id = ?
      ORDER BY created_at DESC
    `).all(subscriptionId) as Invoice[];
  }

  updatePaymentResult(
    id: string,
    result: {
      status: 'succeeded' | 'failed' | 'refunded';
      provider_reference?: string | null;
      failure_reason?: string | null;
    }
  ): Invoice {
    const update = this.db.prepare(`
      UPDATE invoices
      SET status = ?,
          provider_reference = ?,
          failure_reason = ?
      WHERE id = ?
    `).run(
      result.status,
      result.provider_reference ?? null,
      result.failure_reason ?? null,
      id
    );

    if (update.changes === 0) {
      throw new Error(`Invoice not found: ${id}`);
    }

    const invoice = this.findById(id);

    if (!invoice) {
      throw new Error('Invoice update failed');
    }

    return invoice;
  }
}
