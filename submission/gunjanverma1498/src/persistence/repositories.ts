import type {
  AuditEvent,
  Customer,
  Invoice,
  Subscription,
  WebhookEventRecord,
} from '../domain/types';
import { InMemoryRepository } from './InMemoryRepository';

export class CustomerRepository extends InMemoryRepository<Customer> {
  protected idOf(entity: Customer): string {
    return entity.id;
  }
}

export class SubscriptionRepository extends InMemoryRepository<Subscription> {
  protected idOf(entity: Subscription): string {
    return entity.id;
  }

  findByCustomer(customerId: string): Subscription[] {
    return this.find((s) => s.customerId === customerId);
  }
}

export class InvoiceRepository extends InMemoryRepository<Invoice> {
  protected idOf(entity: Invoice): string {
    return entity.id;
  }

  findBySubscription(subscriptionId: string): Invoice[] {
    return this.find((i) => i.subscriptionId === subscriptionId);
  }
}

/**
 * Tracks every processed webhook `event_id`. The presence of a row here is the
 * idempotency guarantee: a redelivered event is detected and dropped.
 */
export class WebhookEventRepository extends InMemoryRepository<WebhookEventRecord> {
  protected idOf(entity: WebhookEventRecord): string {
    return entity.eventId;
  }

  has(eventId: string): boolean {
    return this.findById(eventId) !== undefined;
  }
}

/** Append-only audit log; ordering preserved by a monotonic sequence. */
export class EventLogRepository extends InMemoryRepository<AuditEvent> {
  protected idOf(entity: AuditEvent): string {
    return entity.id;
  }

  findBySubscription(subscriptionId: string): AuditEvent[] {
    return this.find((e) => e.subscriptionId === subscriptionId).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }
}

/**
 * Aggregates all repositories so the service and the test environment share a
 * single, resettable persistence boundary.
 */
export class Database {
  readonly customers = new CustomerRepository();
  readonly subscriptions = new SubscriptionRepository();
  readonly invoices = new InvoiceRepository();
  readonly webhookEvents = new WebhookEventRepository();
  readonly eventLog = new EventLogRepository();

  /** Wipe all state — used to isolate every test run. */
  reset(): void {
    this.customers.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
    this.eventLog.clear();
  }
}
