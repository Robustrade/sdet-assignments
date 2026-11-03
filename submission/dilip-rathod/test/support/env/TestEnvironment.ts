import { afterEach, beforeEach } from 'vitest';
import { buildContainer } from '../../../src/container';
import { createApp } from '../../../src/http/app';
import { Database } from '../../../src/persistence/Database';
import { CustomerRepository } from '../../../src/persistence/repositories/CustomerRepository';
import { HttpClient } from '../api/HttpClient';
import { SubscriptionApiClient } from '../api/SubscriptionApiClient';
import { InvariantChecker } from '../assertions/InvariantChecker';
import { aCustomer } from '../builders/builders';
import type { CustomerBuilder, CustomerSeed } from '../builders/builders';
import { PersistenceInspector } from '../persistence/PersistenceInspector';
import { MockPaymentProvider } from '../provider/MockPaymentProvider';
import { LifecycleDriver } from '../scenarios/LifecycleDriver';
import { WebhookSimulator } from '../webhooks/WebhookSimulator';
import { FakeClock } from './FakeClock';

export const TEST_WEBHOOK_SECRET = 'whsec_test_only_not_a_real_secret';
const DEFAULT_START = '2026-01-01T09:00:00.000Z';

/** Seeds reference data (customers, payment methods) that has no API of its own. */
export class Seeder {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly clock: FakeClock,
  ) {}

  customer(builder: CustomerBuilder = aCustomer()): CustomerSeed {
    const seed = builder.build();
    const at = this.clock.iso();
    this.customers.insert({ id: seed.id, email: seed.email, createdAt: at });
    for (const id of seed.paymentMethodIds) this.customers.insertPaymentMethod({ id, customerId: seed.id, createdAt: at });
    return seed;
  }
}

/**
 * Facade over one isolated copy of the system: fresh in-memory database, fake clock, mock
 * provider and app, plus the clients and inspectors a spec needs. Nothing is shared between tests.
 */
export class TestEnvironment {
  readonly given: LifecycleDriver;
  private invariantsEnabled = true;

  private constructor(
    private readonly database: Database,
    readonly clock: FakeClock,
    readonly provider: MockPaymentProvider,
    readonly api: SubscriptionApiClient,
    readonly webhooks: WebhookSimulator,
    readonly db: PersistenceInspector,
    readonly seed: Seeder,
  ) {
    this.given = new LifecycleDriver(this);
  }

  static async create(options: { startAt?: string } = {}): Promise<TestEnvironment> {
    const database = await Database.open();
    const clock = new FakeClock(options.startAt ?? DEFAULT_START);
    const provider = new MockPaymentProvider();
    const container = buildContainer({ db: database, paymentProvider: provider, clock, webhookSecret: TEST_WEBHOOK_SECRET });
    const http = new HttpClient(createApp(container));

    return new TestEnvironment(
      database,
      clock,
      provider,
      new SubscriptionApiClient(http),
      new WebhookSimulator(http, TEST_WEBHOOK_SECRET),
      new PersistenceInspector(database),
      new Seeder(new CustomerRepository(database), clock),
    );
  }

  /** For tests that deliberately corrupt the database to prove a schema guarantee. */
  skipInvariantCheck(): void {
    this.invariantsEnabled = false;
  }

  async verifyInvariants(): Promise<void> {
    if (this.invariantsEnabled) await new InvariantChecker().assertHolds(this.db, this.provider, this.api);
  }

  dispose(): void {
    this.database.close();
  }
}

/**
 * Registers a fresh environment per test and checks all global invariants after each one.
 * Usage: `const env = useTestEnvironment();` then `env().api...` inside tests.
 */
export function useTestEnvironment(options?: { startAt?: string }): () => TestEnvironment {
  let current: TestEnvironment | undefined;
  beforeEach(async () => {
    current = await TestEnvironment.create(options);
  });
  afterEach(async () => {
    try {
      await current?.verifyInvariants();
    } finally {
      current?.dispose();
      current = undefined;
    }
  });
  return () => {
    if (!current) throw new Error('useTestEnvironment(): environment is only available inside a test');
    return current;
  };
}
