import type { AuditEvent, Invoice, Subscription, WebhookEventRecord } from './types';

/** In-memory, queryable persistence for the fixture. Seeded per test run. */
export class InMemoryStore {
  subscriptions = new Map<string, Subscription>();
  invoices = new Map<string, Invoice>();
  webhookEvents = new Map<string, WebhookEventRecord>();
  auditLog: AuditEvent[] = [];
  /** Customers known to the fixture; anything else is an "unknown customer". */
  customers = new Set<string>(['cust_001', 'cust_002', 'cust_003']);
}

export class SubscriptionRepository {
  constructor(private readonly store: InMemoryStore) {}

  save(subscription: Subscription): void {
    this.store.subscriptions.set(subscription.id, subscription);
  }

  findById(id: string): Subscription | undefined {
    return this.store.subscriptions.get(id);
  }

  listAll(): Subscription[] {
    return [...this.store.subscriptions.values()];
  }
}

export class InvoiceRepository {
  constructor(private readonly store: InMemoryStore) {}

  save(invoice: Invoice): void {
    this.store.invoices.set(invoice.id, invoice);
  }

  findById(id: string): Invoice | undefined {
    return this.store.invoices.get(id);
  }

  findBySubscription(subscriptionId: string): Invoice[] {
    return [...this.store.invoices.values()].filter((i) => i.subscriptionId === subscriptionId);
  }

  findByReference(reference: string): Invoice | undefined {
    return [...this.store.invoices.values()].find((i) => i.reference === reference);
  }
}

export class WebhookEventRepository {
  constructor(private readonly store: InMemoryStore) {}

  hasProcessed(eventId: string): boolean {
    return this.store.webhookEvents.has(eventId);
  }

  record(event: WebhookEventRecord): void {
    this.store.webhookEvents.set(event.eventId, event);
  }
}

export class AuditLogRepository {
  constructor(private readonly store: InMemoryStore) {}

  append(event: AuditEvent): void {
    this.store.auditLog.push(event);
  }

  findBySubscription(subscriptionId: string): AuditEvent[] {
    return this.store.auditLog.filter((e) => e.subscriptionId === subscriptionId);
  }
}
