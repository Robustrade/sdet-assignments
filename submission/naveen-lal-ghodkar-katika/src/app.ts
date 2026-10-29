import express, { Express } from 'express';
import type { AuditLogRepository } from './persistence/AuditLogRepository';
import type { CustomerRepository } from './persistence/CustomerRepository';
import type { IdempotencyRepository } from './persistence/IdempotencyRepository';
import type { InvoiceRepository } from './persistence/InvoiceRepository';
import type { SubscriptionRepository } from './persistence/SubscriptionRepository';
import type { WebhookEventRepository } from './persistence/WebhookEventRepository';
import { InMemoryAuditLogRepository } from './persistence/InMemoryAuditLogRepository';
import { InMemoryCustomerRepository } from './persistence/InMemoryCustomerRepository';
import { InMemoryIdempotencyRepository } from './persistence/InMemoryIdempotencyRepository';
import { InMemoryInvoiceRepository } from './persistence/InMemoryInvoiceRepository';
import { InMemorySubscriptionRepository } from './persistence/InMemorySubscriptionRepository';
import { InMemoryWebhookEventRepository } from './persistence/InMemoryWebhookEventRepository';
import type { PaymentProvider } from './providers/PaymentProvider';
import { UnconfiguredPaymentProvider } from './providers/UnconfiguredPaymentProvider';
import { errorHandler } from './http/errorHandler';
import { subscriptionRoutes } from './http/subscriptionRoutes';
import { BillingScheduler } from './services/BillingScheduler';
import { BillingService } from './services/BillingService';
import { SubscriptionService } from './services/SubscriptionService';
import { WebhookService } from './services/WebhookService';
import { webhookRoutes } from './http/webhookRoutes';
import { SystemClock, type Clock } from './support/Clock';
import { RandomIdGenerator, type IdGenerator } from './support/IdGenerator';
import { KeyedMutex } from './support/KeyedMutex';

/** Everything the service depends on. Tests inject their own; production-like defaults are in-memory. */
export interface AppDependencies {
  subscriptions: SubscriptionRepository;
  customers: CustomerRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
  auditLog: AuditLogRepository;
  idempotency: IdempotencyRepository;
  clock: Clock;
  ids: IdGenerator;
  /** The external payment provider. Tests inject a mock; the default refuses to charge. */
  paymentProvider: PaymentProvider;
  /** Shared secret for webhook signatures. Unset means the webhook endpoint refuses to run (fails closed). */
  webhookSecret?: string;
}

function defaultDependencies(): AppDependencies {
  return {
    subscriptions: new InMemorySubscriptionRepository(),
    customers: new InMemoryCustomerRepository(['cust_001', 'cust_002']),
    invoices: new InMemoryInvoiceRepository(),
    webhookEvents: new InMemoryWebhookEventRepository(),
    auditLog: new InMemoryAuditLogRepository(),
    idempotency: new InMemoryIdempotencyRepository(),
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
    paymentProvider: new UnconfiguredPaymentProvider(),
    webhookSecret: process.env.PROVIDER_WEBHOOK_SECRET,
  };
}

/** The HTTP app plus the billing run, which has no HTTP endpoint (the assignment defines none). */
export interface BillingServiceInstance {
  app: Express;
  billingScheduler: BillingScheduler;
}

/** Same wiring as `createApp`, but also hands back the billing scheduler. */
export function createService(overrides: Partial<AppDependencies> = {}): BillingServiceInstance {
  const deps: AppDependencies = { ...defaultDependencies(), ...overrides };
  // One mutex shared by every writer of subscription state (API cancel, webhooks, billing run).
  const mutex = new KeyedMutex();
  const billing = new BillingService(deps.paymentProvider);
  const billingScheduler = new BillingScheduler(
    deps.subscriptions,
    deps.invoices,
    deps.auditLog,
    billing,
    deps.clock,
    deps.ids,
    mutex,
  );
  const subscriptionService = new SubscriptionService(
    deps.subscriptions,
    deps.customers,
    deps.invoices,
    deps.auditLog,
    deps.idempotency,
    billing,
    deps.clock,
    deps.ids,
    mutex,
  );

  const webhookService = new WebhookService(
    deps.subscriptions,
    deps.invoices,
    deps.webhookEvents,
    deps.auditLog,
    deps.clock,
    mutex,
  );

  const app = express();
  // The webhook route needs the raw bytes for its signature, so it goes before the JSON body parser.
  app.use(webhookRoutes(webhookService, deps.webhookSecret));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use(subscriptionRoutes(subscriptionService));

  app.use(errorHandler); // must be registered last

  return { app, billingScheduler };
}

export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  return createService(overrides).app;
}
