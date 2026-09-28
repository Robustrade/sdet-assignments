import type {
  AuditEntry,
  Customer,
  Invoice,
  Payment,
  Subscription,
  WebhookEventRecord,
} from '../domain/types';

/**
 * Embedded, queryable persistence. Each "table" is a Map keyed by primary key.
 * Tests get a brand-new instance per test, so there is no shared/stale data.
 */
export class InMemoryDatabase {
  readonly customers = new Map<string, Customer>();
  readonly subscriptions = new Map<string, Subscription>();
  readonly invoices = new Map<string, Invoice>();
  readonly payments = new Map<string, Payment>();
  readonly webhookEvents = new Map<string, WebhookEventRecord>();
  readonly auditLog: AuditEntry[] = [];

  truncateAll(): void {
    this.customers.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.payments.clear();
    this.webhookEvents.clear();
    this.auditLog.length = 0;
  }
}
