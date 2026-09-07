import {
  SubscriptionRepository, InvoiceRepository, WebhookEventRepository, AuditLogRepository, CustomerRepository,
} from './repository';
import {
  Subscription, Invoice, WebhookEventRecord, AuditLogEntry, Customer,
} from '../domain/types';

export class InMemoryCustomerRepository implements CustomerRepository {
  private store = new Map<string, Customer>();

  save(customer: Customer): void {
    this.store.set(customer.id, { ...customer });
  }

  exists(id: string): boolean {
    return this.store.has(id);
  }

  get(id: string): Customer | undefined {
    const c = this.store.get(id);
    return c ? { ...c } : undefined;
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private store = new Map<string, Subscription>();

  save(sub: Subscription): void {
    this.store.set(sub.id, { ...sub });
  }

  get(id: string): Subscription | undefined {
    const s = this.store.get(id);
    return s ? { ...s } : undefined;
  }

  all(): Subscription[] {
    return Array.from(this.store.values()).map((s) => ({ ...s }));
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private store: Invoice[] = [];

  save(invoice: Invoice): void {
    this.store.push({ ...invoice });
  }

  forSubscription(subscriptionId: string): Invoice[] {
    return this.store.filter((i) => i.subscriptionId === subscriptionId).map((i) => ({ ...i }));
  }

  all(): Invoice[] {
    return this.store.map((i) => ({ ...i }));
  }
}

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private store = new Map<string, WebhookEventRecord>();

  hasProcessed(eventId: string): boolean {
    return this.store.has(eventId);
  }

  save(record: WebhookEventRecord): void {
    this.store.set(record.eventId, { ...record });
  }

  get(eventId: string): WebhookEventRecord | undefined {
    const r = this.store.get(eventId);
    return r ? { ...r } : undefined;
  }

  forSubscription(subscriptionId: string): WebhookEventRecord[] {
    return Array.from(this.store.values())
      .filter((r) => r.subscriptionId === subscriptionId)
      .map((r) => ({ ...r }));
  }

  all(): WebhookEventRecord[] {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private store: AuditLogEntry[] = [];

  append(entry: AuditLogEntry): void {
    this.store.push({ ...entry });
  }

  forSubscription(subscriptionId: string): AuditLogEntry[] {
    return this.store.filter((e) => e.subscriptionId === subscriptionId).map((e) => ({ ...e }));
  }
}

export interface Store {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
  auditLog: AuditLogRepository;
}

export function createInMemoryStore(): Store {
  return {
    customers: new InMemoryCustomerRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
    invoices: new InMemoryInvoiceRepository(),
    webhookEvents: new InMemoryWebhookEventRepository(),
    auditLog: new InMemoryAuditLogRepository(),
  };
}
