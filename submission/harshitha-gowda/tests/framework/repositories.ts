import type { DatabaseSync } from 'node:sqlite';

export interface SubscriptionRecord {
  id: string; customer_id: string; plan: string; status: string; amount: number; currency: string;
  trial_ends_at: string | null; failed_attempts: number;
}
export interface InvoiceRecord { id: string; subscription_id: string; amount: number; currency: string; status: string; provider_ref: string | null }
export interface WebhookEventRecord { seq: number; event_id: string; type: string; subscription_id: string; outcome: string }
export interface AuditRecord { seq: number; subscription_id: string; from_status: string | null; to_status: string; trigger: string; source: string }

/** Read-only repositories: specs never contain raw SQL. */
export class SubscriptionRepository {
  constructor(private db: DatabaseSync) {}
  find(id: string) { return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as SubscriptionRecord | undefined; }
  count() { return (this.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as { n: number }).n; }
}

export class InvoiceRepository {
  constructor(private db: DatabaseSync) {}
  forSubscription(subId: string) { return this.db.prepare('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at, rowid').all(subId) as unknown as InvoiceRecord[]; }
  find(id: string) { return this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as InvoiceRecord | undefined; }
  count() { return (this.db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n; }
}

export class WebhookEventRepository {
  constructor(private db: DatabaseSync) {}
  byEventId(eventId: string) { return this.db.prepare('SELECT * FROM webhook_events WHERE event_id = ? ORDER BY seq').all(eventId) as unknown as WebhookEventRecord[]; }
  count() { return (this.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get() as { n: number }).n; }
  all() { return this.db.prepare('SELECT * FROM webhook_events ORDER BY seq').all() as unknown as WebhookEventRecord[]; }
}

export class AuditRepository {
  constructor(private db: DatabaseSync) {}
  forSubscription(subId: string) { return this.db.prepare('SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY seq').all(subId) as unknown as AuditRecord[]; }
}

export class PersistenceInspector {
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly audit: AuditRepository;
  constructor(db: DatabaseSync) {
    this.subscriptions = new SubscriptionRepository(db);
    this.invoices = new InvoiceRepository(db);
    this.webhookEvents = new WebhookEventRepository(db);
    this.audit = new AuditRepository(db);
  }
}
