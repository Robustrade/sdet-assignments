import { createApp } from '../../src/app.js';
import type { Invoice } from '../../src/domain/types.js';
import { buildService } from '../../src/index.js';
import type { Database } from '../../src/persistence/Database.js';
import { ConsistencyVerifier } from './assertions/ConsistencyVerifier.js';
import { ProviderVerifier } from './assertions/ProviderVerifier.js';
import { SubscriptionBuilder } from './builders/SubscriptionBuilder.js';
import { SubscriptionApiClient } from './clients/ApiClient.js';
import { WebhookSimulator } from './clients/WebhookSimulator.js';
import { FakePaymentProvider } from './doubles/FakePaymentProvider.js';
import { SteppingClock } from './doubles/SteppingClock.js';
import {
  AuditReadRepository,
  InvoiceReadRepository,
  SubscriptionReadRepository,
  WebhookEventReadRepository,
} from './repositories/ReadRepositories.js';

export const WEBHOOK_SECRET = 'whsec_test_secret';

/**
 * Factory + fixture. `TestEnvironment.create()` builds a fresh service (own in-memory
 * database, own fake provider, own clock) wrapped in its own Express app, so no state can
 * leak between tests.
 */
export class TestEnvironment {
  readonly db: Database;
  readonly provider: FakePaymentProvider;
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookSimulator;
  readonly subscriptions: SubscriptionReadRepository;
  readonly invoices: InvoiceReadRepository;
  readonly events: WebhookEventReadRepository;
  readonly audit: AuditReadRepository;
  readonly verify: ConsistencyVerifier;
  readonly charges: ProviderVerifier;

  private constructor(db: Database, provider: FakePaymentProvider, api: SubscriptionApiClient) {
    this.db = db;
    this.provider = provider;
    this.api = api;
    this.webhooks = new WebhookSimulator(api, WEBHOOK_SECRET);
    this.subscriptions = new SubscriptionReadRepository(db);
    this.invoices = new InvoiceReadRepository(db);
    this.events = new WebhookEventReadRepository(db);
    this.audit = new AuditReadRepository(db);
    this.verify = new ConsistencyVerifier({
      api,
      subscriptions: this.subscriptions,
      invoices: this.invoices,
      audit: this.audit,
    });
    this.charges = new ProviderVerifier(provider);
  }

  static create(options: { maxFailedAttempts?: number } = {}): TestEnvironment {
    const provider = new FakePaymentProvider();
    const { db, service } = buildService({
      provider,
      now: new SteppingClock().now,
      maxFailedAttempts: options.maxFailedAttempts,
    });
    db.customers.add('cust_001'); // seed data
    const api = new SubscriptionApiClient(createApp(service, WEBHOOK_SECRET));
    return new TestEnvironment(db, provider, api);
  }

  aSubscription(): SubscriptionBuilder {
    return new SubscriptionBuilder(this);
  }

  /**
   * Runs a billing attempt that times out at the provider, leaving a `pending` invoice whose
   * outcome only a webhook can settle. Clears the provider history afterwards.
   */
  async leavePendingInvoice(subscriptionId: string): Promise<Invoice> {
    this.provider.alwaysTimeout();
    const response = await this.api.billSubscription(subscriptionId);
    if (response.status !== 200) throw new Error(`Setup failed: ${JSON.stringify(response)}`);
    this.provider.reset();
    const invoice = this.invoices.latest(subscriptionId);
    if (invoice.status !== 'pending') throw new Error('Expected a pending invoice');
    return invoice;
  }
}
