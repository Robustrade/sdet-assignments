import { SubscriptionService } from './SubscriptionService.js';
import { Database } from './persistence/Database.js';
import {
  AuditLogRepository,
  CustomerRepository,
  InvoiceRepository,
  SubscriptionRepository,
  WebhookEventRepository,
} from './persistence/repositories.js';
import type { PaymentProvider } from './payment/PaymentProvider.js';

export interface Wiring {
  db: Database;
  service: SubscriptionService;
}

/** Composition root: wires the service to a database and a payment provider. */
export function buildService(options: {
  provider: PaymentProvider;
  now?: () => Date;
  maxFailedAttempts?: number;
  db?: Database;
}): Wiring {
  const db = options.db ?? new Database();
  const service = new SubscriptionService({
    subscriptions: new SubscriptionRepository(db),
    invoices: new InvoiceRepository(db),
    webhookEvents: new WebhookEventRepository(db),
    auditLog: new AuditLogRepository(db),
    customers: new CustomerRepository(db),
    provider: options.provider,
    now: options.now ?? (() => new Date()),
    maxFailedAttempts: options.maxFailedAttempts ?? 3,
  });
  return { db, service };
}
