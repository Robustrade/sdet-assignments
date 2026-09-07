import {
  Subscription, Invoice, WebhookEventRecord, AuditLogEntry, Customer,
} from '../domain/types';

export interface CustomerRepository {
  save(customer: Customer): void;
  exists(id: string): boolean;
  get(id: string): Customer | undefined;
}

export interface SubscriptionRepository {
  save(sub: Subscription): void;
  get(id: string): Subscription | undefined;
  all(): Subscription[];
}

export interface InvoiceRepository {
  save(invoice: Invoice): void;
  forSubscription(subscriptionId: string): Invoice[];
  all(): Invoice[];
}

export interface WebhookEventRepository {
  hasProcessed(eventId: string): boolean;
  save(record: WebhookEventRecord): void;
  get(eventId: string): WebhookEventRecord | undefined;
  forSubscription(subscriptionId: string): WebhookEventRecord[];
  all(): WebhookEventRecord[];
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): void;
  forSubscription(subscriptionId: string): AuditLogEntry[];
}
