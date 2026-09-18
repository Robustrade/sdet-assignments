import type {
  CustomerRecord,
  InvoiceRecord,
  SubscriptionEventRecord,
  SubscriptionRecord,
  WebhookEventRecord
} from './records';

/**
 * Embedded, queryable store. Tables are Maps keyed by primary key so the
 * repositories below read like a thin DAO over real tables; swapping in
 * better-sqlite3 would only change the repository bodies.
 */
export class InMemoryDatabase {
  readonly customers = new Map<string, CustomerRecord>();
  readonly subscriptions = new Map<string, SubscriptionRecord>();
  readonly invoices = new Map<string, InvoiceRecord>();
  readonly webhookEvents = new Map<string, WebhookEventRecord>();
  readonly subscriptionEvents = new Map<string, SubscriptionEventRecord>();

  reset(): void {
    this.customers.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
    this.subscriptionEvents.clear();
  }
}
