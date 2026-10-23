import { InMemorySubscriptionBillingRepository } from './repository.ts';
import { FakePaymentGateway } from './provider.ts';
import { SubscriptionBillingService } from './service.ts';
import { startBillingHttpFixture } from './http.ts';
import { BillingApiClient } from './client.ts';
export async function createBillingTestFixture() {
  const db = new InMemorySubscriptionBillingRepository();
  const provider = new FakePaymentGateway();
  const service = new SubscriptionBillingService(db, provider);
  const secret = 'isolated-test-secret';
  const server = await startBillingHttpFixture(service, secret);
  return { db, provider, service, api: new BillingApiClient(server.baseUrl, secret),
    baseUrl: server.baseUrl, secret, close: server.close };
}
