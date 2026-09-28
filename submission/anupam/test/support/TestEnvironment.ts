import { buildContainer, type Container } from '../../src/app/container';
import type { Customer } from '../../src/domain/types';
import { createApp } from '../../src/http/createApp';
import type { BillingRunResult } from '../../src/services/BillingEngine';
import { ConsistencyVerifier } from './ConsistencyVerifier';
import { FakeClock } from './FakeClock';
import { InvariantChecker } from './InvariantChecker';
import { MockPaymentProvider } from './MockPaymentProvider';
import { RecordingNotifier } from './RecordingNotifier';
import { ScenarioDriver } from './ScenarioDriver';
import { SubscriptionApiClient } from './SubscriptionApiClient';
import { WebhookSimulator } from './WebhookSimulator';

export const TEST_WEBHOOK_SECRET = 'whsec_test_only';

/**
 * PATTERN: Factory + Facade for the test fixture.
 *
 * `TestEnvironment.create()` wires a fresh, fully isolated world per test:
 * new DB, new id sequence, new clock, new mock provider, new app.
 * Nothing is shared between tests -> no ordering dependencies, no stale data.
 *
 *   REAL   : HTTP layer, services, state machine, repositories, in-memory DB, HMAC verification
 *   FAKE   : PaymentProvider (MockPaymentProvider), Clock (FakeClock), Notifier (RecordingNotifier)
 *   DRIVER : WebhookSimulator (acts as the provider sending webhooks), runBilling (acts as the scheduler)
 */
export class TestEnvironment {
  readonly clock = new FakeClock();
  readonly provider = new MockPaymentProvider();
  readonly notifier = new RecordingNotifier();
  readonly container: Container;
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookSimulator;
  readonly verify: ConsistencyVerifier;
  readonly invariants: InvariantChecker;
  readonly given: ScenarioDriver;

  private constructor() {
    this.container = buildContainer({
      paymentProvider: this.provider,
      clock: this.clock,
      notifier: this.notifier,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
    const app = createApp(this.container);
    this.api = new SubscriptionApiClient(app);
    this.webhooks = new WebhookSimulator(app, TEST_WEBHOOK_SECRET);
    this.verify = new ConsistencyVerifier(this.api, this.repos);
    this.invariants = new InvariantChecker(this.repos, this.container.catalog, this.provider);
    this.given = new ScenarioDriver(this);
  }

  static create(): TestEnvironment {
    return new TestEnvironment();
  }

  get repos() {
    return this.container.repos;
  }

  seedCustomer(c: Customer): Customer {
    return this.repos.customers.insert(c);
  }

  /** Stands in for the billing scheduler/cron job. */
  runBilling(subscriptionId: string): Promise<BillingRunResult> {
    return this.container.billing.runDue(subscriptionId);
  }

  /** Common teardown assertions for every spec. */
  assertCleanTeardown(): void {
    this.invariants.assertHolds();
    expect(this.provider.unusedOutcomes).toBe(0); // scripted charges that never happened = a lying test
  }
}
