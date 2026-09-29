import type { DatabaseSync } from 'node:sqlite';

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  retry_count: number;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface AttemptRow {
  id: string;
  invoice_id: string;
  attempt_no: number;
  idempotency_key: string;
  status: string;
  provider_ref: string | null;
}

export interface WebhookEventRow {
  event_id: string;
  type: string;
  subscription_id: string | null;
  invoice_id: string | null;
  outcome: string;
  delivery_count: number;
}

export interface AuditRow {
  id: number;
  subscription_id: string;
  from_status: string | null;
  to_status: string;
  trigger: string;
  source: string;
  reference: string | null;
}

const TABLES = ['subscriptions', 'invoices', 'payment_attempts', 'webhook_events', 'subscription_audit_log'] as const;
export type TableName = (typeof TABLES)[number];

/**
 * Read-only view of persisted state for assertions. Uses its own SQL on purpose:
 * reading through the service's repositories would let a repository bug hide itself.
 * node:sqlite returns null-prototype rows, so every row is spread into a plain object.
 */
export class DbInspector {
  constructor(private readonly db: DatabaseSync) {}

  subscription(id: string): SubscriptionRow | undefined {
    return this.one<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', id);
  }

  subscriptions(): SubscriptionRow[] {
    return this.all<SubscriptionRow>('SELECT * FROM subscriptions ORDER BY id');
  }

  invoicesFor(subscriptionId: string): InvoiceRow[] {
    return this.all<InvoiceRow>('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY rowid', subscriptionId);
  }

  attemptsFor(subscriptionId: string): AttemptRow[] {
    return this.all<AttemptRow>(
      `SELECT a.* FROM payment_attempts a JOIN invoices i ON i.id = a.invoice_id
       WHERE i.subscription_id = ? ORDER BY a.rowid`,
      subscriptionId,
    );
  }

  webhookEvent(eventId: string): WebhookEventRow | undefined {
    return this.one<WebhookEventRow>('SELECT * FROM webhook_events WHERE event_id = ?', eventId);
  }

  auditLog(subscriptionId: string): AuditRow[] {
    return this.all<AuditRow>('SELECT * FROM subscription_audit_log WHERE subscription_id = ? ORDER BY id', subscriptionId);
  }

  count(table: TableName): number {
    if (!TABLES.includes(table)) throw new Error(`unknown table ${table}`);
    return this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
  }

  /** Row counts for every table: compare before/after to prove "nothing was persisted". */
  snapshotCounts(): Record<TableName, number> {
    return Object.fromEntries(TABLES.map((t) => [t, this.count(t)])) as Record<TableName, number>;
  }

  query<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.all<T>(sql, ...params);
  }

  private one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
    const row = this.db.prepare(sql).get(...params);
    return row ? ({ ...row } as T) : undefined;
  }

  private all<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params).map((row) => ({ ...row }) as T);
  }
}
