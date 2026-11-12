import type { AuditEntry, Invoice, Subscription, WebhookEventRecord } from '../domain/types.js';
import type { Database } from './Database.js';

// Repositories hand out copies, never live rows, so callers cannot mutate storage by accident.

export class CustomerRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  exists(id: string): boolean {
    return this.db.customers.has(id);
  }
}

export class SubscriptionRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  nextId(): string {
    return `sub_${this.db.subscriptions.size + 1}`;
  }
  save(subscription: Subscription): void {
    this.db.subscriptions.set(subscription.id, structuredClone(subscription));
  }
  get(id: string): Subscription | undefined {
    const row = this.db.subscriptions.get(id);
    return row ? structuredClone(row) : undefined;
  }
}

export class InvoiceRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  nextId(): string {
    return `inv_${this.db.invoices.size + 1}`;
  }
  save(invoice: Invoice): void {
    this.db.invoices.set(invoice.id, structuredClone(invoice));
  }
  get(id: string): Invoice | undefined {
    const row = this.db.invoices.get(id);
    return row ? structuredClone(row) : undefined;
  }
}

export class WebhookEventRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  save(event: WebhookEventRecord): void {
    this.db.webhookEvents.set(event.eventId, structuredClone(event));
  }
  get(eventId: string): WebhookEventRecord | undefined {
    const row = this.db.webhookEvents.get(eventId);
    return row ? structuredClone(row) : undefined;
  }
}

export class AuditLogRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  append(entry: AuditEntry): void {
    this.db.auditLog.push(structuredClone(entry));
  }
}
