import { Express } from 'express';
import { createApp, AppDependencies } from '../../src/api/app';
import { InMemoryDatabase } from '../../src/infrastructure/persistence/InMemoryDatabase';
import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/InMemorySubscriptionRepository';
import { InMemoryInvoiceRepository } from '../../src/infrastructure/persistence/InMemoryInvoiceRepository';
import { InMemoryWebhookEventRepository } from '../../src/infrastructure/persistence/InMemoryWebhookEventRepository';
import { MockPaymentProvider } from '../../src/infrastructure/payment/MockPaymentProvider';

export interface TestContext {
  app: Express;
  db: InMemoryDatabase;
  subscriptionRepo: InMemorySubscriptionRepository;
  invoiceRepo: InMemoryInvoiceRepository;
  webhookEventRepo: InMemoryWebhookEventRepository;
  mockPaymentProvider: MockPaymentProvider;
}

export function setupTestEnvironment(): TestContext {
  const db = new InMemoryDatabase();
  const subscriptionRepo = new InMemorySubscriptionRepository(db);
  const invoiceRepo = new InMemoryInvoiceRepository(db);
  const webhookEventRepo = new InMemoryWebhookEventRepository(db);
  const mockPaymentProvider = new MockPaymentProvider();

  const dependencies: AppDependencies = {
    subscriptionRepo,
    invoiceRepo,
    webhookEventRepo,
    paymentProvider: mockPaymentProvider
  };

  const app = createApp(dependencies);

  return {
    app,
    db,
    subscriptionRepo,
    invoiceRepo,
    webhookEventRepo,
    mockPaymentProvider
  };
}
