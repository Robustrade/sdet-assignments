import { Express } from 'express';
import { buildApp } from '../http/app';
import { SubscriptionService } from '../domain/subscriptionService';
import { createInMemoryStore, Store } from '../persistence/inMemoryRepository';
import { MockPaymentProvider } from './mockPaymentProvider';
import { SubscriptionApiClient } from './apiClient';
import { FixtureSeeder } from './fixtureSeeder';

export interface TestContext {
  app: Express;
  api: SubscriptionApiClient;
  service: SubscriptionService;
  store: Store;
  provider: MockPaymentProvider;
}

export function createTestContext(): TestContext {
  const store = createInMemoryStore();
  FixtureSeeder.seedCustomers(store);
  const provider = new MockPaymentProvider();
  const service = new SubscriptionService(store, provider);
  const app = buildApp(service);
  const api = new SubscriptionApiClient(app);
  return {
    app, api, service, store, provider,
  };
}
