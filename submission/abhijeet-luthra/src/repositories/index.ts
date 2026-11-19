import { Db } from '../db/database';
import { CustomerRepository } from './customer-repository';
import { IdempotencyKeyRepository } from './idempotency-key-repository';
import { InvoiceRepository } from './invoice-repository';
import { PaymentRepository } from './payment-repository';
import { PlanRepository } from './plan-repository';
import { SnapshotRepository } from './snapshot-repository';
import { SubscriptionEventRepository } from './subscription-event-repository';
import { SubscriptionRepository } from './subscription-repository';
import { WebhookEventRepository } from './webhook-event-repository';

/** All repositories over one database connection - shared by services and test assertions. */
export interface Repositories {
  customers: CustomerRepository;
  plans: PlanRepository;
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  payments: PaymentRepository;
  webhookEvents: WebhookEventRepository;
  subscriptionEvents: SubscriptionEventRepository;
  idempotencyKeys: IdempotencyKeyRepository;
  snapshots: SnapshotRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    customers: new CustomerRepository(db),
    plans: new PlanRepository(db),
    subscriptions: new SubscriptionRepository(db),
    invoices: new InvoiceRepository(db),
    payments: new PaymentRepository(db),
    webhookEvents: new WebhookEventRepository(db),
    subscriptionEvents: new SubscriptionEventRepository(db),
    idempotencyKeys: new IdempotencyKeyRepository(db),
    snapshots: new SnapshotRepository(db),
  };
}
