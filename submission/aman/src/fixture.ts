import { InMemoryBillingRepository } from './repository.ts';
import { FakePaymentProvider } from './provider.ts';
import { BillingService } from './service.ts';
import { startFixture } from './http.ts';
import { ApiClient } from './client.ts';
export async function makeFixture() {
  const db = new InMemoryBillingRepository();
  const provider = new FakePaymentProvider();
  const service = new BillingService(db, provider);
  const secret = 'isolated-test-secret';
  const server = await startFixture(service, secret);
  return { db, provider, service, api: new ApiClient(server.baseUrl, secret),
    baseUrl: server.baseUrl, secret, close: server.close };
}
