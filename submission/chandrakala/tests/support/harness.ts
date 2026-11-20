import { createApp } from '../../src/app.ts';
import { BillingService } from '../../src/service.ts';
import { BillingRepository } from '../../src/repository.ts';
import { ProviderTimeout, type Clock, type ChargeRequest, type PaymentProvider } from '../../src/domain.ts';
import { HttpClient, SubscriptionApiClient, WebhookSimulator } from './client.ts';
import { SubscriptionBuilder } from './builders.ts';
import { BillingVerifier } from './verifier.ts';

export class TestClock implements Clock {
  private instant = new Date('2026-01-01T12:00:00.000Z');
  now(): Date { return new Date(this.instant); }
  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 86400000);
  }
}
/** Recording test double: no gateway or outbound network call. */
export class MockPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private outcome: 'success' | 'decline' | 'timeout' = 'success';
  handler?: (request: ChargeRequest) => Promise<'success' | 'decline'>;
  async charge(request: ChargeRequest): Promise<'success' | 'decline'> {
    this.calls.push(structuredClone(request));
    if (this.handler) return this.handler(request);
    if (this.outcome === 'timeout') throw new ProviderTimeout('Gateway timeout');
    return this.outcome;
  }
  decline(): void { this.outcome = 'decline'; }
  timeout(): void { this.outcome = 'timeout'; }
  succeed(): void { this.outcome = 'success'; }
}
export class BillingHarness {
  readonly clock = new TestClock();
  readonly provider = new MockPaymentProvider();
  readonly repo: BillingRepository;
  readonly service: BillingService;
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookSimulator;
  readonly verify: BillingVerifier;
  readonly server: ReturnType<typeof createApp>;
  constructor(path?: string) {
    this.repo = new BillingRepository(path);
    this.repo.seedCustomer('cust_001'); this.repo.seedCustomer('cust_002');
    this.service = new BillingService(this.repo, this.provider, this.clock);
    this.server = createApp(this.service, 'fixture-only-webhook-secret');
    const http = new HttpClient(this.server);
    this.api = new SubscriptionApiClient(http);
    this.webhooks = new WebhookSimulator(http, 'fixture-only-webhook-secret');
    this.verify = new BillingVerifier(this.repo, this.api, this.provider);
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.off('error', reject); resolve(); });
    });
  }
  create(plan = 'basic') { return this.api.create(new SubscriptionBuilder().with({plan}).build()); }
  async pendingTrial() {
    const created = await this.create();
    this.clock.advanceDays(7); this.provider.timeout();
    return (await this.api.bill(created.body.subscription.id)).body;
  }
  async close(): Promise<void> {
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close(error => error ? reject(error) : resolve());
        this.server.closeAllConnections();
      });
    }
    this.repo.close();
  }
}
