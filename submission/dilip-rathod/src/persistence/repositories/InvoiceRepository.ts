import type { Invoice, InvoiceStatus } from '../../domain/types';
import type { Database } from '../Database';

interface InvoiceRow {
  id: string;
  subscription_id: string;
  plan: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  created_at: string;
  paid_at: string | null;
  closed_at: string | null;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    plan: row.plan,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    closedAt: row.closed_at,
  };
}

/** Invoice status changes are guarded on the expected current status; each returns whether it applied. */
export class InvoiceRepository {
  constructor(private readonly db: Database) {}

  insert(i: Invoice): void {
    this.db.run(
      `INSERT INTO invoices (id, subscription_id, plan, amount, currency, status, period_start, period_end,
         created_at, paid_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [i.id, i.subscriptionId, i.plan, i.amount, i.currency, i.status, i.periodStart, i.periodEnd, i.createdAt, i.paidAt, i.closedAt],
    );
  }

  find(id: string): Invoice | undefined {
    const row = this.db.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', [id]);
    return row && toInvoice(row);
  }

  findOpen(subscriptionId: string): Invoice | undefined {
    const row = this.db.get<InvoiceRow>("SELECT * FROM invoices WHERE subscription_id = ? AND status = 'open'", [subscriptionId]);
    return row && toInvoice(row);
  }

  listFor(subscriptionId: string): Invoice[] {
    return this.db
      .all<InvoiceRow>('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_start, created_at', [subscriptionId])
      .map(toInvoice);
  }

  markPaid(id: string, atIso: string): boolean {
    return this.db.run("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'open'", [atIso, id]) === 1;
  }

  close(id: string, status: 'uncollectible' | 'void', atIso: string): boolean {
    return this.db.run("UPDATE invoices SET status = ?, closed_at = ? WHERE id = ? AND status = 'open'", [status, atIso, id]) === 1;
  }

  markRefunded(id: string, atIso: string): boolean {
    return this.db.run("UPDATE invoices SET status = 'refunded', closed_at = ? WHERE id = ? AND status = 'paid'", [atIso, id]) === 1;
  }
}
