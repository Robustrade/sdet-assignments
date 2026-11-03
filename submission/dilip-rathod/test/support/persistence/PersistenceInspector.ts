import type { Database, Param } from '../../../src/persistence/Database';
import { EXPECTED_TABLES } from '../../../src/persistence/schema';

export type TableName = (typeof EXPECTED_TABLES)[number];

/* Row shapes exactly as stored (snake_case), so assertions read against the real schema. */
export interface SubscriptionRow {
  id: string;
  customer_id: string;
  payment_method_id: string;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  retry_count: number;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  subscription_id: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  period_start: string;
  period_end: string;
  created_at: string;
  paid_at: string | null;
  closed_at: string | null;
}

export interface AttemptRow {
  id: string;
  invoice_id: string;
  attempt_number: number;
  idempotency_key: string;
  amount: number;
  status: string;
  provider_charge_id: string | null;
  decline_code: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface WebhookEventRow {
  event_id: string;
  type: string;
  subscription_id: string | null;
  invoice_id: string | null;
  payload: string;
  outcome: string;
  reason: string | null;
  received_at: string;
}

export interface DeliveryRow {
  seq: number;
  event_id: string;
  received_at: string;
  is_duplicate: number;
}

export interface AuditRow {
  seq: number;
  subscription_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  cause: string | null;
  reference: string | null;
  detail: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  subscription_id: string;
  kind: string;
  reference: string | null;
  created_at: string;
}

export type TableCounts = Record<TableName, number>;

/**
 * Read-only repository over the service's database for assertions. It uses its own SQL rather
 * than the service's repositories, so a mapping bug in the service cannot make a test agree with it.
 */
export class PersistenceInspector {
  constructor(private readonly db: Database) {}

  subscription(id: string): SubscriptionRow | undefined {
    return this.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id]);
  }

  subscriptions(): SubscriptionRow[] {
    return this.db.all<SubscriptionRow>('SELECT * FROM subscriptions ORDER BY created_at, rowid');
  }

  invoicesFor(subscriptionId: string): InvoiceRow[] {
    return this.db.all<InvoiceRow>('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_start, rowid', [subscriptionId]);
  }

  invoice(id: string): InvoiceRow | undefined {
    return this.db.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', [id]);
  }

  invoices(): InvoiceRow[] {
    return this.db.all<InvoiceRow>('SELECT * FROM invoices ORDER BY created_at, rowid');
  }

  attemptsFor(invoiceId: string): AttemptRow[] {
    return this.db.all<AttemptRow>('SELECT * FROM payment_attempts WHERE invoice_id = ? ORDER BY attempt_number', [invoiceId]);
  }

  attemptsForSubscription(subscriptionId: string): AttemptRow[] {
    return this.db.all<AttemptRow>(
      `SELECT a.* FROM payment_attempts a JOIN invoices i ON i.id = a.invoice_id
       WHERE i.subscription_id = ? ORDER BY i.period_start, a.attempt_number`,
      [subscriptionId],
    );
  }

  attempts(): AttemptRow[] {
    return this.db.all<AttemptRow>('SELECT * FROM payment_attempts ORDER BY created_at, rowid');
  }

  webhookEvent(eventId: string): WebhookEventRow | undefined {
    return this.db.get<WebhookEventRow>('SELECT * FROM webhook_events WHERE event_id = ?', [eventId]);
  }

  webhookEvents(): WebhookEventRow[] {
    return this.db.all<WebhookEventRow>('SELECT * FROM webhook_events ORDER BY received_at, rowid');
  }

  deliveriesFor(eventId: string): DeliveryRow[] {
    return this.db.all<DeliveryRow>('SELECT * FROM webhook_deliveries WHERE event_id = ? ORDER BY seq', [eventId]);
  }

  deliveries(): DeliveryRow[] {
    return this.db.all<DeliveryRow>('SELECT * FROM webhook_deliveries ORDER BY seq');
  }

  auditTrail(subscriptionId: string): AuditRow[] {
    return this.db.all<AuditRow>('SELECT * FROM audit_log WHERE subscription_id = ? ORDER BY seq', [subscriptionId]);
  }

  /** Status-changing audit entries only, as "from->to" strings. */
  statusHistory(subscriptionId: string): string[] {
    return this.auditTrail(subscriptionId)
      .filter((e) => e.event_type === 'created' || e.event_type === 'status_changed')
      .map((e) => `${e.from_status ?? '∅'}->${e.to_status}`);
  }

  notificationsFor(subscriptionId: string): NotificationRow[] {
    return this.db.all<NotificationRow>('SELECT * FROM notifications WHERE subscription_id = ? ORDER BY created_at, rowid', [subscriptionId]);
  }

  counts(): TableCounts {
    const counts = {} as TableCounts;
    for (const table of EXPECTED_TABLES) {
      counts[table] = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
    }
    return counts;
  }

  /**
   * Escape hatch for tests that deliberately bypass the service to prove a database-level
   * guarantee (e.g. "the schema rejects canceled -> active"). Never used to set up state.
   */
  unsafeExecute(sql: string, params: Param[] = []): void {
    this.db.run(sql, params);
  }
}
