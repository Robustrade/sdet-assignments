import { ConcurrentModificationError, NotFoundError } from '../domain/errors';
import type {
  AuditEntry,
  Customer,
  Invoice,
  Payment,
  Subscription,
  SubscriptionStatus,
  WebhookEventRecord,
} from '../domain/types';
import type { InMemoryDatabase } from './InMemoryDatabase';

/**
 * PATTERN: Repository.
 *
 * All reads/writes go through these classes - both from the service AND from
 * the test verification layer. No test pokes at raw Maps.
 * Every read/write clones, so a caller can never mutate stored rows by accident
 * (which would otherwise hide bugs / create false positives).
 */
const clone = <T>(v: T): T => structuredClone(v);

export class CustomerRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  insert(c: Customer): Customer {
    this.db.customers.set(c.id, clone(c));
    return clone(c);
  }
  findById(id: string): Customer | undefined {
    const c = this.db.customers.get(id);
    return c && clone(c);
  }
}

/** Everything except status/identity - status can only change via transition(). */
export type SubscriptionPatch = Partial<
  Omit<Subscription, 'id' | 'customerId' | 'status' | 'version' | 'createdAt'>
>;

export class SubscriptionRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  insert(s: Subscription): Subscription {
    this.db.subscriptions.set(s.id, clone(s));
    return clone(s);
  }
  findById(id: string): Subscription | undefined {
    const s = this.db.subscriptions.get(id);
    return s && clone(s);
  }
  getById(id: string): Subscription {
    const s = this.findById(id);
    if (!s) throw new NotFoundError('Subscription', id);
    return s;
  }
  all(): Subscription[] {
    return [...this.db.subscriptions.values()].map(clone);
  }

  /** Non-status updates. The type forbids passing `status`. */
  update(id: string, expectedVersion: number, patch: SubscriptionPatch): Subscription {
    return this.write(id, expectedVersion, patch);
  }

  /**
   * The ONLY way to persist a new status. Called exclusively by LifecycleManager,
   * which validates the move against the state machine first.
   */
  saveTransition(
    id: string,
    expectedVersion: number,
    status: SubscriptionStatus,
    patch: SubscriptionPatch = {},
  ): Subscription {
    return this.write(id, expectedVersion, { ...patch, status });
  }

  private write(
    id: string,
    expectedVersion: number,
    patch: SubscriptionPatch & { status?: SubscriptionStatus },
  ): Subscription {
    const current = this.db.subscriptions.get(id);
    if (!current) throw new NotFoundError('Subscription', id);
    if (current.version !== expectedVersion) throw new ConcurrentModificationError(id);
    const next: Subscription = { ...current, ...clone(patch), version: current.version + 1 };
    this.db.subscriptions.set(id, next);
    return clone(next);
  }
}

export class InvoiceRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  insert(i: Invoice): Invoice {
    this.db.invoices.set(i.id, clone(i));
    return clone(i);
  }
  findById(id: string): Invoice | undefined {
    const i = this.db.invoices.get(id);
    return i && clone(i);
  }
  update(i: Invoice): Invoice {
    if (!this.db.invoices.has(i.id)) throw new NotFoundError('Invoice', i.id);
    this.db.invoices.set(i.id, clone(i));
    return clone(i);
  }
  findBySubscription(subscriptionId: string): Invoice[] {
    return [...this.db.invoices.values()]
      .filter((i) => i.subscriptionId === subscriptionId)
      .map(clone);
  }
  latestForSubscription(subscriptionId: string): Invoice | undefined {
    return this.findBySubscription(subscriptionId).at(-1);
  }
  all(): Invoice[] {
    return [...this.db.invoices.values()].map(clone);
  }
}

export class PaymentRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  insert(p: Payment): Payment {
    this.db.payments.set(p.id, clone(p));
    return clone(p);
  }
  update(p: Payment): Payment {
    if (!this.db.payments.has(p.id)) throw new NotFoundError('Payment', p.id);
    this.db.payments.set(p.id, clone(p));
    return clone(p);
  }
  findByInvoice(invoiceId: string): Payment[] {
    return [...this.db.payments.values()].filter((p) => p.invoiceId === invoiceId).map(clone);
  }
  findBySubscription(subscriptionId: string): Payment[] {
    return [...this.db.payments.values()]
      .filter((p) => p.subscriptionId === subscriptionId)
      .map(clone);
  }
  pendingForInvoice(invoiceId: string): Payment | undefined {
    return this.findByInvoice(invoiceId).find((p) => p.status === 'pending');
  }
  all(): Payment[] {
    return [...this.db.payments.values()].map(clone);
  }
}

export class WebhookEventRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  findById(eventId: string): WebhookEventRecord | undefined {
    const e = this.db.webhookEvents.get(eventId);
    return e && clone(e);
  }
  insert(e: WebhookEventRecord): WebhookEventRecord {
    this.db.webhookEvents.set(e.eventId, clone(e));
    return clone(e);
  }
  update(e: WebhookEventRecord): WebhookEventRecord {
    this.db.webhookEvents.set(e.eventId, clone(e));
    return clone(e);
  }
  delete(eventId: string): void {
    this.db.webhookEvents.delete(eventId);
  }
  all(): WebhookEventRecord[] {
    return [...this.db.webhookEvents.values()].map(clone);
  }
}

export class AuditLogRepository {
  constructor(private readonly db: InMemoryDatabase) {}
  append(entry: Omit<AuditEntry, 'seq'>): AuditEntry {
    const row: AuditEntry = { ...entry, seq: this.db.auditLog.length + 1 };
    this.db.auditLog.push(clone(row));
    return clone(row);
  }
  forSubscription(subscriptionId: string): AuditEntry[] {
    return this.db.auditLog.filter((e) => e.subscriptionId === subscriptionId).map(clone);
  }
  all(): AuditEntry[] {
    return this.db.auditLog.map(clone);
  }
}

export interface Repositories {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  payments: PaymentRepository;
  webhookEvents: WebhookEventRepository;
  audit: AuditLogRepository;
}

export const createRepositories = (db: InMemoryDatabase): Repositories => ({
  customers: new CustomerRepository(db),
  subscriptions: new SubscriptionRepository(db),
  invoices: new InvoiceRepository(db),
  payments: new PaymentRepository(db),
  webhookEvents: new WebhookEventRepository(db),
  audit: new AuditLogRepository(db),
});
