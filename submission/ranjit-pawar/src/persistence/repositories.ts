import { DomainError } from '../domain/errors';
import type { InMemoryDatabase } from './in-memory-database';
import type {
  CustomerRecord,
  InvoiceRecord,
  SubscriptionEventRecord,
  SubscriptionRecord,
  WebhookEventRecord
} from './records';

/**
 * REPOSITORY PATTERN.
 *
 * Both the service and the test suite read persistence through these classes.
 * Tests never poke at the underlying Maps, so a storage swap does not rewrite
 * the assertions, and every read is defensively cloned so a test can never
 * mutate service state by accident (a classic source of false greens).
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class CustomerRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  insert(record: CustomerRecord): CustomerRecord {
    this.db.customers.set(record.id, clone(record));
    return clone(record);
  }

  findById(id: string): CustomerRecord | null {
    const found = this.db.customers.get(id);
    return found ? clone(found) : null;
  }

  requireById(id: string): CustomerRecord {
    const found = this.findById(id);
    if (!found) throw DomainError.unknownCustomer(id);
    return found;
  }

  all(): CustomerRecord[] {
    return [...this.db.customers.values()].map(clone);
  }
}

export class SubscriptionRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  insert(record: SubscriptionRecord): SubscriptionRecord {
    this.db.subscriptions.set(record.id, clone(record));
    return clone(record);
  }

  findById(id: string): SubscriptionRecord | null {
    const found = this.db.subscriptions.get(id);
    return found ? clone(found) : null;
  }

  requireById(id: string): SubscriptionRecord {
    const found = this.findById(id);
    if (!found) throw DomainError.subscriptionNotFound(id);
    return found;
  }

  update(id: string, patch: Partial<SubscriptionRecord>): SubscriptionRecord {
    const current = this.db.subscriptions.get(id);
    if (!current) throw DomainError.subscriptionNotFound(id);
    const updated = { ...current, ...clone(patch) };
    this.db.subscriptions.set(id, updated);
    return clone(updated);
  }

  all(): SubscriptionRecord[] {
    return [...this.db.subscriptions.values()].map(clone);
  }

  findByCustomer(customerId: string): SubscriptionRecord[] {
    return this.all().filter((s) => s.customer_id === customerId);
  }

  /** Trial ended, billing period ended, or a scheduled retry has come due. */
  findDueForBilling(now: Date): SubscriptionRecord[] {
    const due = (at: string | null): boolean => at !== null && new Date(at).getTime() <= now.getTime();
    return this.all()
      .filter((s) => {
        if (s.state === 'trialing') return due(s.trial_ends_at);
        if (s.state === 'active') return due(s.current_period_end);
        if (s.state === 'past_due') return due(s.next_retry_at);
        return false;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

export class InvoiceRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  insert(record: InvoiceRecord): InvoiceRecord {
    this.db.invoices.set(record.id, clone(record));
    return clone(record);
  }

  findById(id: string): InvoiceRecord | null {
    const found = this.db.invoices.get(id);
    return found ? clone(found) : null;
  }

  requireById(id: string): InvoiceRecord {
    const found = this.findById(id);
    if (!found) throw DomainError.invoiceNotFound(id);
    return found;
  }

  update(id: string, patch: Partial<InvoiceRecord>): InvoiceRecord {
    const current = this.db.invoices.get(id);
    if (!current) throw DomainError.invoiceNotFound(id);
    const updated = { ...current, ...clone(patch) };
    this.db.invoices.set(id, updated);
    return clone(updated);
  }

  all(): InvoiceRecord[] {
    return [...this.db.invoices.values()].map(clone);
  }

  findBySubscription(subscriptionId: string): InvoiceRecord[] {
    return this.all()
      .filter((i) => i.subscription_id === subscriptionId)
      .sort((a, b) => a.attempt - b.attempt);
  }

  findPendingBySubscription(subscriptionId: string): InvoiceRecord | null {
    return this.findBySubscription(subscriptionId).find((i) => i.status === 'pending') ?? null;
  }

  countBySubscription(subscriptionId: string): number {
    return this.findBySubscription(subscriptionId).length;
  }
}

export class WebhookEventRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  /** The idempotency key for inbound provider events. */
  exists(eventId: string): boolean {
    return this.db.webhookEvents.has(eventId);
  }

  insert(record: WebhookEventRecord): WebhookEventRecord {
    this.db.webhookEvents.set(record.event_id, clone(record));
    return clone(record);
  }

  findById(eventId: string): WebhookEventRecord | null {
    const found = this.db.webhookEvents.get(eventId);
    return found ? clone(found) : null;
  }

  /**
   * Records that an already-processed event was delivered again. This is the
   * only write a duplicate is allowed to make: it is an audit counter, never a
   * business side effect.
   */
  recordRedelivery(eventId: string, at: string): WebhookEventRecord {
    const current = this.db.webhookEvents.get(eventId);
    if (!current) throw new Error(`Cannot record redelivery of unknown event ${eventId}`);
    const updated = { ...current, delivery_count: current.delivery_count + 1, last_delivered_at: at };
    this.db.webhookEvents.set(eventId, updated);
    return clone(updated);
  }

  all(): WebhookEventRecord[] {
    return [...this.db.webhookEvents.values()].map(clone);
  }

  findBySubscription(subscriptionId: string): WebhookEventRecord[] {
    return this.all()
      .filter((e) => e.subscription_id === subscriptionId)
      .sort((a, b) => a.received_at.localeCompare(b.received_at));
  }
}

export class SubscriptionEventLogRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  append(record: Omit<SubscriptionEventRecord, 'seq'>): SubscriptionEventRecord {
    const seq = this.findBySubscription(record.subscription_id).length + 1;
    const full: SubscriptionEventRecord = { ...clone(record), seq };
    this.db.subscriptionEvents.set(full.id, full);
    return clone(full);
  }

  all(): SubscriptionEventRecord[] {
    return [...this.db.subscriptionEvents.values()];
  }

  findBySubscription(subscriptionId: string): SubscriptionEventRecord[] {
    return this.all()
      .filter((e) => e.subscription_id === subscriptionId)
      .sort((a, b) => a.seq - b.seq)
      .map(clone);
  }

  transitionsFor(subscriptionId: string): SubscriptionEventRecord[] {
    return this.findBySubscription(subscriptionId).filter((e) => e.kind === 'transition');
  }
}

/** Aggregate handed to the service and to the test assertions layer. */
export class Repositories {
  readonly customers: CustomerRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly subscriptionEvents: SubscriptionEventLogRepository;

  constructor(readonly db: InMemoryDatabase) {
    this.customers = new CustomerRepository(db);
    this.subscriptions = new SubscriptionRepository(db);
    this.invoices = new InvoiceRepository(db);
    this.webhookEvents = new WebhookEventRepository(db);
    this.subscriptionEvents = new SubscriptionEventLogRepository(db);
  }
}
