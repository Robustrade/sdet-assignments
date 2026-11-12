import type { Db } from '../database';
import { AuditRepository } from './auditRepository';
import { CustomerRepository } from './customerRepository';
import { InvoiceRepository } from './invoiceRepository';
import { PaymentMethodRepository } from './paymentMethodRepository';
import { SubscriptionRepository } from './subscriptionRepository';
import { WebhookEventRepository } from './webhookEventRepository';

/** One repository per table. The service and the tests both read the database through these. */
export interface Repositories {
  readonly customers: CustomerRepository;
  readonly paymentMethods: PaymentMethodRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly audit: AuditRepository;
}

export function createRepositories(db: Db, overrides: Partial<Repositories> = {}): Repositories {
  return {
    customers: overrides.customers ?? new CustomerRepository(db),
    paymentMethods: overrides.paymentMethods ?? new PaymentMethodRepository(db),
    subscriptions: overrides.subscriptions ?? new SubscriptionRepository(db),
    invoices: overrides.invoices ?? new InvoiceRepository(db),
    webhookEvents: overrides.webhookEvents ?? new WebhookEventRepository(db),
    audit: overrides.audit ?? new AuditRepository(db),
  };
}

export {
  AuditRepository,
  CustomerRepository,
  InvoiceRepository,
  PaymentMethodRepository,
  SubscriptionRepository,
  WebhookEventRepository,
};
