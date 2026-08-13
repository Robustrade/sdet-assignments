import { createApp } from '../../src/app.js';
import { PlanCatalog } from '../../src/domain/PlanCatalog.js';
import { PLANS } from '../../src/domain/Plan.js';
import { SubscriptionService } from '../../src/services/SubscriptionService.js';
import { WebhookService } from '../../src/services/WebhookService.js';
import { createDb } from '../../src/persistence/db.js';
import { SubscriptionRepository } from '../../src/persistence/SubscriptionRepository.js';
import { InvoiceRepository } from '../../src/persistence/InvoiceRepository.js';
import { WebhookEventRepository } from '../../src/persistence/WebhookEventRepository.js';
import { FakePaymentProvider } from './FakePaymentProvider.js';
import { ApiClientFactory } from './ApiClientFactory.js';
import { WebhookSimulator } from './WebhookSimulator.js';
import type { TestEnvironment } from './contracts.js';
import type { ApiClient } from './contracts.js';

export const TEST_SIGNING_SECRET = 'test-webhook-signing-secret';

export function createTestEnvironment(): TestEnvironment {
  const db = createDb(':memory:');
  const provider = new FakePaymentProvider();
  const plans = new PlanCatalog(PLANS);
  const subscriptions = new SubscriptionRepository(db);
  const invoices = new InvoiceRepository(db);
  const webhookEvents = new WebhookEventRepository(db);

  const subscriptionService = new SubscriptionService(plans, provider, subscriptions, invoices);
  const webhookService = new WebhookService(
    TEST_SIGNING_SECRET,
    subscriptions,
    invoices,
    webhookEvents,
    plans,
  );

  const app = createApp({ subscriptionService, webhookService });

  const env: TestEnvironment = {
    app,
    provider,
    subscriptions,
    invoices,
    webhookEvents,
    signingSecret: TEST_SIGNING_SECRET,
    apiClient: undefined as unknown as ApiClient,
    webhookSimulator: undefined as unknown as WebhookSimulator,
  };

  env.apiClient = ApiClientFactory.forEnvironment(env);
  env.webhookSimulator = new WebhookSimulator(env.apiClient, TEST_SIGNING_SECRET);
  return env;
}