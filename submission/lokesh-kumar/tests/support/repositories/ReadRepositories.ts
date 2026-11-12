import type { Database } from '../../../src/persistence/Database.js';
import type { AuditEntry, Invoice, Subscription, WebhookEventRecord } from '../../../src/domain/types.js';

// Read-only views over the service's tables, used by the verification layer. Tests never
// touch the Database maps directly, and every row returned is a copy.

export class SubscriptionReadRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  get(id: string): Subscription | undefined {
    const row = this.db.subscriptions.get(id);
    return row ? structuredClone(row) : undefined;
  }
  count(): number {
    return this.db.subscriptions.size;
  }
}

export class InvoiceReadRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  forSubscription(subscriptionId: string): Invoice[] {
    return [...this.db.invoices.values()]
      .filter((i) => i.subscriptionId === subscriptionId)
      .map((i) => structuredClone(i));
  }
  latest(subscriptionId: string): Invoice {
    const all = this.forSubscription(subscriptionId);
    if (all.length === 0) throw new Error(`No invoices for ${subscriptionId}`);
    return all[all.length - 1];
  }
  count(): number {
    return this.db.invoices.size;
  }
}

export class WebhookEventReadRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  get(eventId: string): WebhookEventRecord | undefined {
    const row = this.db.webhookEvents.get(eventId);
    return row ? structuredClone(row) : undefined;
  }
  count(): number {
    return this.db.webhookEvents.size;
  }
}

export class AuditReadRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  forSubscription(subscriptionId: string): AuditEntry[] {
    return this.db.auditLog.filter((e) => e.subscriptionId === subscriptionId).map((e) => structuredClone(e));
  }
}
