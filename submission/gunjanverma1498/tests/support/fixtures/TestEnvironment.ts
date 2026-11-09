import type { Express } from 'express';
import { defaultPlanCatalog } from '../../../src/domain/plans';
import type { Customer } from '../../../src/domain/types';
import { createApp } from '../../../src/http/app';
import { Database } from '../../../src/persistence/repositories';
import { BillingService } from '../../../src/service/BillingService';
import { FixedClock } from '../../../src/support/clock';
import { ApiClientFactory } from '../clients/ApiClientFactory';
import type { BillingApiClient } from '../clients/BillingApiClient';
import { FakePaymentProvider } from '../doubles/FakePaymentProvider';
import { WebhookEventBuilder } from '../builders/WebhookEventBuilder';

export const WEBHOOK_SECRET = 'test-webhook-secret';

export const SEEDED_CUSTOMER: Customer = {
  id: 'cust_001',
  email: 'ada@example.com',
  paymentMethodIds: ['pm_test_visa_4242', 'pm_test_mc_5555'],
};

/**
 * Test fixture / environment setup.
 *
 * Owns the entire system under test for a single test: a fresh database, an
 * injected fake provider, a deterministic clock, the wired service, and a typed
 * API client. Every test gets its own instance (see `setup()` used in
 * `beforeEach`), which guarantees isolation and prevents stale-data false
 * positives. It also exposes the repositories and the fake provider directly so
 * the assertion layer can inspect persisted state and provider interactions.
 */
export class TestEnvironment {
  readonly db: Database;
  readonly provider: FakePaymentProvider;
  readonly clock: FixedClock;
  readonly service: BillingService;
  readonly app: Express;
  readonly api: BillingApiClient;
  readonly webhookSecret = WEBHOOK_SECRET;

  private constructor(providerDefault: Parameters<FakePaymentProvider['willReturn']>[0]) {
    this.db = new Database();
    this.provider = new FakePaymentProvider(providerDefault);
    this.clock = new FixedClock();
    this.service = new BillingService({
      db: this.db,
      paymentProvider: this.provider,
      plans: defaultPlanCatalog(),
      clock: this.clock,
      webhookSecret: WEBHOOK_SECRET,
      maxRetries: 3,
    });
    this.app = createApp(this.service);
    this.api = ApiClientFactory.forApp(this.app);
  }

  /** Build a fresh environment with a default customer seeded. */
  static setup(
    providerDefault: Parameters<FakePaymentProvider['willReturn']>[0] = 'success',
  ): TestEnvironment {
    const env = new TestEnvironment(providerDefault);
    env.seedCustomer(SEEDED_CUSTOMER);
    return env;
  }

  seedCustomer(customer: Customer): Customer {
    return this.db.customers.insert(customer);
  }

  /** Convenience factory for webhook payloads already bound to the test secret. */
  webhook(): WebhookEventBuilder {
    return WebhookEventBuilder.anEvent(this.webhookSecret);
  }

  /** The id of the only open/paid invoice on a subscription (test convenience). */
  latestInvoiceId(subscriptionId: string): string {
    const invoices = this.db.invoices.findBySubscription(subscriptionId);
    const latest = invoices.at(-1);
    if (!latest) throw new Error(`no invoice for subscription ${subscriptionId}`);
    return latest.id;
  }
}
