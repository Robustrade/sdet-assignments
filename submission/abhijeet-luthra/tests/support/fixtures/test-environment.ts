import { seedReferenceData } from '../../../src/db/seed';
import { Invoice, Payment, Subscription, SubscriptionEvent, WebhookEvent } from '../../../src/domain/types';
import { buildFixture, Fixture } from '../../../src/fixture';
import { Repositories } from '../../../src/repositories';
import { findInvariantViolations } from '../assertions/invariant-checker';
import { SubscriptionApiClient } from '../clients/subscription-api-client';
import { MockPaymentProvider } from '../mocks/mock-payment-provider';
import { WebhookSimulator } from '../mocks/webhook-simulator';
import { FakeClock } from './fake-clock';

export const WEBHOOK_SECRET = 'whsec_test_fixture_secret';
export const START_TIME = '2026-01-01T09:00:00.000Z';

/**
 * One isolated world per test: fresh in-memory SQLite + seed data, a fresh mock
 * provider, a fake clock, the Express app, and helpers to read persisted state.
 */
export class TestEnvironment {
  clock!: FakeClock;
  provider!: MockPaymentProvider;
  fixture!: Fixture;
  api!: SubscriptionApiClient;
  webhooks!: WebhookSimulator;
  /** Unexpected errors the service logged (500 responses), for assertions. */
  loggedErrors: unknown[] = [];

  get repos(): Repositories {
    return this.fixture.repos;
  }

  reset(): void {
    this.clock = new FakeClock(START_TIME);
    this.provider = new MockPaymentProvider();
    this.loggedErrors = [];
    this.fixture = buildFixture({
      paymentProvider: this.provider,
      webhookSecret: WEBHOOK_SECRET,
      clock: this.clock,
      logError: (error) => this.loggedErrors.push(error),
    });
    seedReferenceData(this.fixture.repos, START_TIME);
    this.api = new SubscriptionApiClient(this.fixture.app);
    this.webhooks = new WebhookSimulator(this.api, WEBHOOK_SECRET);
  }

  /** Moves time forward, then lets the billing runner do whatever is due. */
  async advanceDaysAndRunBilling(days: number): Promise<{ chargesAttempted: number }> {
    this.clock.advanceDays(days);
    return this.fixture.billingRunner.runDue();
  }

  runBilling(): Promise<{ chargesAttempted: number }> {
    return this.fixture.billingRunner.runDue();
  }

  subscription(id: string): Subscription {
    const s = this.repos.subscriptions.findById(id);
    if (!s) throw new Error(`No subscription ${id}`);
    return s;
  }

  invoicesOf(subscriptionId: string): Invoice[] {
    return this.repos.invoices.findBySubscription(subscriptionId);
  }

  /** The most recent invoice (throws if none) - looked up by the scenario's own subscription id. */
  latestInvoiceOf(subscriptionId: string): Invoice {
    const invoices = this.invoicesOf(subscriptionId);
    if (invoices.length === 0) throw new Error(`No invoices for ${subscriptionId}`);
    return invoices[invoices.length - 1];
  }

  paymentsOf(subscriptionId: string): Payment[] {
    return this.repos.payments.findBySubscription(subscriptionId);
  }

  auditOf(subscriptionId: string): SubscriptionEvent[] {
    return this.repos.subscriptionEvents.findBySubscription(subscriptionId);
  }

  auditTrail(subscriptionId: string): string[] {
    return this.auditOf(subscriptionId).map((e) => `${e.previousStatus ?? 'none'}->${e.newStatus}`);
  }

  webhookEvent(eventId: string): WebhookEvent | undefined {
    return this.repos.webhookEvents.findById(eventId);
  }

  assertInvariants(): void {
    const violations = findInvariantViolations(this.repos);
    if (violations.length > 0) {
      throw new Error(`Persistence invariants violated after test:\n  - ${violations.join('\n  - ')}`);
    }
  }

  close(): void {
    this.fixture.db.close();
  }
}

/**
 * Registers beforeEach/afterEach hooks (like a JUnit base class) and returns the
 * environment. After every test the persistence invariants are checked.
 */
export function useTestEnvironment(): TestEnvironment {
  const env = new TestEnvironment();
  beforeEach(() => env.reset());
  afterEach(() => {
    try {
      env.assertInvariants();
    } finally {
      env.close();
    }
  });
  return env;
}
