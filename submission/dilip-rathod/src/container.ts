import { BillingService } from './billing/BillingService';
import { PaymentOutcomeHandler } from './billing/PaymentOutcomeHandler';
import { SubscriptionLifecycle } from './domain/SubscriptionLifecycle';
import type { PaymentProvider } from './payments/PaymentProvider';
import type { Database } from './persistence/Database';
import { CustomerRepository } from './persistence/repositories/CustomerRepository';
import { AuditLogRepository, NotificationOutbox, WebhookEventRepository } from './persistence/repositories/EventRepositories';
import { InvoiceRepository } from './persistence/repositories/InvoiceRepository';
import { PaymentAttemptRepository } from './persistence/repositories/PaymentAttemptRepository';
import { SubscriptionRepository } from './persistence/repositories/SubscriptionRepository';
import { PlanCatalog } from './plans/PlanPolicy';
import { SubscriptionService } from './services/SubscriptionService';
import type { Clock, IdGenerator } from './shared/infrastructure';
import { RandomIdGenerator, SystemClock } from './shared/infrastructure';
import { WebhookService, WebhookSignatureVerifier } from './webhooks/WebhookService';

export interface ServiceDependencies {
  db: Database;
  paymentProvider: PaymentProvider;
  webhookSecret: string;
  clock?: Clock;
  ids?: IdGenerator;
  plans?: PlanCatalog;
}

/** Composition root: the one place where concrete implementations are chosen. */
export function buildContainer(deps: ServiceDependencies) {
  const { db, paymentProvider } = deps;
  const clock = deps.clock ?? new SystemClock();
  const ids = deps.ids ?? new RandomIdGenerator();
  const plans = deps.plans ?? PlanCatalog.default();

  const customers = new CustomerRepository(db);
  const subscriptions = new SubscriptionRepository(db);
  const invoices = new InvoiceRepository(db);
  const attempts = new PaymentAttemptRepository(db);
  const events = new WebhookEventRepository(db);
  const audit = new AuditLogRepository(db);
  const outbox = new NotificationOutbox(db, () => ids.next('ntf'));

  const lifecycle = new SubscriptionLifecycle(subscriptions, audit, outbox);
  const outcomes = new PaymentOutcomeHandler(subscriptions, invoices, attempts, audit, outbox, lifecycle, plans, clock);
  const billing = new BillingService(db, subscriptions, invoices, attempts, outcomes, paymentProvider, plans, clock, ids);
  const subscriptionService = new SubscriptionService(db, customers, subscriptions, invoices, audit, lifecycle, billing, plans, clock, ids);
  const webhooks = new WebhookService(db, events, invoices, attempts, outcomes, clock);

  return {
    plans,
    repositories: { customers, subscriptions, invoices, attempts },
    subscriptions: subscriptionService,
    billing,
    webhooks,
    signatureVerifier: new WebhookSignatureVerifier(deps.webhookSecret),
  };
}

export type ServiceContainer = ReturnType<typeof buildContainer>;
