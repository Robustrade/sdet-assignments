import {
  AuditLogRecord,
  CustomerRecord,
  IdempotencyRecord,
  InvoiceRecord,
  SubscriptionRecord,
  WebhookEventRecord
} from './types';

export interface SubscriptionRepository {
  saveCustomer(customer: CustomerRecord): CustomerRecord;
  findCustomerById(id: string): CustomerRecord | undefined;
  listCustomers(): CustomerRecord[];

  saveSubscription(subscription: SubscriptionRecord): SubscriptionRecord;
  findSubscriptionById(id: string): SubscriptionRecord | undefined;
  listSubscriptions(): SubscriptionRecord[];

  saveInvoice(invoice: InvoiceRecord): InvoiceRecord;
  findInvoiceById(id: string): InvoiceRecord | undefined;
  findInvoicesBySubscriptionId(subscriptionId: string): InvoiceRecord[];
  listInvoices(): InvoiceRecord[];

  saveWebhookEvent(event: WebhookEventRecord): WebhookEventRecord;
  findWebhookEventsByEventId(eventId: string): WebhookEventRecord[];
  hasProcessedOrSeenWebhook(eventId: string): boolean;
  findWebhookEventsBySubscriptionId(subscriptionId: string): WebhookEventRecord[];
  listWebhookEvents(): WebhookEventRecord[];

  appendAuditLog(entry: AuditLogRecord): AuditLogRecord;
  findAuditLogsBySubscriptionId(subscriptionId: string): AuditLogRecord[];
  listAuditLogs(): AuditLogRecord[];

  saveIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord;
  findIdempotencyRecord(key: string): IdempotencyRecord | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * In-memory Repository isolating persistence access behind typed domain queries.
 */
export class InMemoryRepository implements SubscriptionRepository {
  private readonly customers = new Map<string, CustomerRecord>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly invoices = new Map<string, InvoiceRecord>();
  private readonly webhookEvents: WebhookEventRecord[] = [];
  private readonly seenWebhookEventIds = new Set<string>();
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  saveCustomer(customer: CustomerRecord): CustomerRecord {
    const stored = clone(customer);
    this.customers.set(stored.id, stored);
    return clone(stored);
  }

  findCustomerById(id: string): CustomerRecord | undefined {
    const found = this.customers.get(id);
    return found ? clone(found) : undefined;
  }

  listCustomers(): CustomerRecord[] {
    return Array.from(this.customers.values(), clone);
  }

  saveSubscription(subscription: SubscriptionRecord): SubscriptionRecord {
    const stored = clone(subscription);
    this.subscriptions.set(stored.id, stored);
    return clone(stored);
  }

  findSubscriptionById(id: string): SubscriptionRecord | undefined {
    const found = this.subscriptions.get(id);
    return found ? clone(found) : undefined;
  }

  listSubscriptions(): SubscriptionRecord[] {
    return Array.from(this.subscriptions.values(), clone);
  }

  saveInvoice(invoice: InvoiceRecord): InvoiceRecord {
    const stored = clone(invoice);
    this.invoices.set(stored.id, stored);
    return clone(stored);
  }

  findInvoiceById(id: string): InvoiceRecord | undefined {
    const found = this.invoices.get(id);
    return found ? clone(found) : undefined;
  }

  findInvoicesBySubscriptionId(subscriptionId: string): InvoiceRecord[] {
    return Array.from(this.invoices.values())
      .filter((inv) => inv.subscription_id === subscriptionId)
      .map(clone);
  }

  listInvoices(): InvoiceRecord[] {
    return Array.from(this.invoices.values(), clone);
  }

  saveWebhookEvent(event: WebhookEventRecord): WebhookEventRecord {
    const stored = clone(event);
    this.webhookEvents.push(stored);
    this.seenWebhookEventIds.add(stored.event_id);
    return clone(stored);
  }

  findWebhookEventsByEventId(eventId: string): WebhookEventRecord[] {
    return this.webhookEvents.filter((e) => e.event_id === eventId).map(clone);
  }

  hasProcessedOrSeenWebhook(eventId: string): boolean {
    return this.seenWebhookEventIds.has(eventId);
  }

  findWebhookEventsBySubscriptionId(subscriptionId: string): WebhookEventRecord[] {
    return this.webhookEvents.filter((e) => e.subscription_id === subscriptionId).map(clone);
  }

  listWebhookEvents(): WebhookEventRecord[] {
    return this.webhookEvents.map(clone);
  }

  appendAuditLog(entry: AuditLogRecord): AuditLogRecord {
    const stored = clone(entry);
    this.auditLogs.push(stored);
    return clone(stored);
  }

  findAuditLogsBySubscriptionId(subscriptionId: string): AuditLogRecord[] {
    return this.auditLogs.filter((l) => l.subscription_id === subscriptionId).map(clone);
  }

  listAuditLogs(): AuditLogRecord[] {
    return this.auditLogs.map(clone);
  }

  saveIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
    const stored = clone(record);
    this.idempotencyRecords.set(stored.key, stored);
    return clone(stored);
  }

  findIdempotencyRecord(key: string): IdempotencyRecord | undefined {
    const found = this.idempotencyRecords.get(key);
    return found ? clone(found) : undefined;
  }
}
