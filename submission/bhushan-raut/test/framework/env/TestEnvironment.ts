import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect } from 'vitest';
import { createApp } from '../../../src/http/app';
import { openDatabase } from '../../../src/persistence/database';
import { aCustomer, type CustomerSeed } from '../builders/CustomerBuilder';
import { SubscriptionApiClient } from '../clients/SubscriptionApiClient';
import { WebhookClient } from '../clients/WebhookClient';
import { FakeClock } from '../doubles/FakeClock';
import { MockPaymentProvider } from '../doubles/MockPaymentProvider';
import { SpyNotifier } from '../doubles/SpyNotifier';
import { WebhookSimulator } from '../doubles/WebhookSimulator';
import { DbInspector } from '../verify/DbInspector';
import { InvariantChecker } from '../verify/InvariantChecker';
import { SubscriptionAssertions } from '../verify/SubscriptionAssertions';
import { Given } from './Given';

export const WEBHOOK_SECRET = 'whsec_test_only';

/**
 * Factory for one fully isolated world per test: a fresh in-memory database, a fresh
 * mock provider, clock and notifier, and the service wired to them. Nothing is shared
 * between tests, so no test can pass or fail because of another test's data.
 */
export class TestEnvironment {
  readonly clock = new FakeClock();
  readonly provider = new MockPaymentProvider();
  readonly notifier = new SpyNotifier();
  readonly simulator = new WebhookSimulator(WEBHOOK_SECRET);
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookClient;
  readonly db: DbInspector;
  readonly invariants: InvariantChecker;
  readonly assert: SubscriptionAssertions;
  readonly given: Given;

  private constructor(private readonly database: DatabaseSync) {
    const app = createApp({
      db: database,
      clock: this.clock,
      paymentProvider: this.provider,
      notifier: this.notifier,
      webhookSecret: WEBHOOK_SECRET,
    });
    this.api = new SubscriptionApiClient(app);
    this.webhooks = new WebhookClient(app);
    this.db = new DbInspector(database);
    this.invariants = new InvariantChecker(this.db, this.provider);
    this.assert = new SubscriptionAssertions(this.api, this.db);
    this.given = new Given(this);
  }

  static create(): TestEnvironment {
    return new TestEnvironment(openDatabase());
  }

  /** Customers are reference data outside this service's API, so they are seeded directly. */
  seedCustomer(customer: CustomerSeed = aCustomer().build()): CustomerSeed {
    this.database.prepare('INSERT INTO customers (id) VALUES (?)').run(customer.id);
    this.database
      .prepare('INSERT INTO payment_methods (id, customer_id) VALUES (?, ?)')
      .run(customer.paymentMethodId, customer.id);
    return customer;
  }

  close(): void {
    this.database.close();
  }
}

/**
 * Registers per-test setup/teardown and returns an accessor for the current environment.
 * Teardown fails the test if any global invariant is broken, or if a scripted provider
 * outcome was never used (an expected charge did not happen).
 */
export function useTestEnvironment(): () => TestEnvironment {
  let current: TestEnvironment | undefined;

  beforeEach(() => {
    current = TestEnvironment.create();
  });

  afterEach(() => {
    const env = current!;
    try {
      expect(env.invariants.violations(), 'global invariants').toEqual([]);
      expect(env.provider.unconsumedOutcomes(), 'scripted provider outcomes never used').toEqual([]);
    } finally {
      env.close();
      current = undefined;
    }
  });

  return () => {
    if (!current) throw new Error('TestEnvironment used outside a test');
    return current;
  };
}
