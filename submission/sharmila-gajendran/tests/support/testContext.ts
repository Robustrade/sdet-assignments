import { afterEach, beforeEach } from 'vitest';
import { createApp } from '../../src/app';
import { createDatabase, type Db } from '../../src/persistence/database';
import { createRepositories, type Repositories } from '../../src/persistence/repositories';
import { aCustomer, type CustomerSeed } from './builders/customerBuilder';
import { SubscriptionApiClient } from './clients/subscriptionApiClient';
import { FakeClock } from './fakes/fakeClock';
import { FaultInjectingAuditRepository } from './mocks/faultInjectingAuditRepository';
import { MockPaymentProvider } from './mocks/mockPaymentProvider';
import { WebhookSimulator } from './mocks/webhookSimulator';
import { SubscriptionSteps } from './steps/subscriptionSteps';
import { CUSTOMER_1, CUSTOMER_2, WEBHOOK_SECRET } from './testData';
import { DbVerifier } from './verifiers/dbVerifier';
import { InvariantChecker } from './verifiers/invariantChecker';
import { ProviderVerifier } from './verifiers/providerVerifier';

export interface TestContextOptions {
  /** Swap in an audit repository that can be told to fail, for partial-failure tests. */
  readonly injectAuditFaults?: boolean;
}

const DEFAULT_CUSTOMERS: readonly CustomerSeed[] = [
  aCustomer().withId(CUSTOMER_1.id).withPaymentMethod(CUSTOMER_1.paymentMethodId).build(),
  aCustomer().withId(CUSTOMER_2.id).withPaymentMethod(CUSTOMER_2.paymentMethodId).build(),
];

function seed(repos: Repositories, customers: readonly CustomerSeed[]): void {
  for (const { customer, paymentMethods } of customers) {
    repos.customers.insert(customer);
    paymentMethods.forEach((paymentMethod) => repos.paymentMethods.insert(paymentMethod));
  }
}

/**
 * Everything one test needs, built fresh for every test: a new in-memory database with the
 * seeded customers, a fake clock, the mock provider, the app wired to them, and the helpers.
 * Nothing is shared between tests, so there is no cleanup and no leftover data.
 */
export class TestContext {
  readonly clock = new FakeClock();
  readonly provider = new MockPaymentProvider();
  readonly db: Db;
  /** The test's own view of the same database. */
  readonly repos: Repositories;
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookSimulator;
  readonly dbCheck: DbVerifier;
  readonly providerCheck: ProviderVerifier;
  readonly invariants: InvariantChecker;
  readonly steps: SubscriptionSteps;
  private readonly auditFaults: FaultInjectingAuditRepository | undefined;

  private constructor(options: TestContextOptions) {
    this.db = createDatabase();
    this.repos = createRepositories(this.db);
    seed(this.repos, DEFAULT_CUSTOMERS);

    this.auditFaults = options.injectAuditFaults ? new FaultInjectingAuditRepository(this.db) : undefined;
    const app = createApp({
      db: this.db,
      paymentProvider: this.provider,
      clock: this.clock,
      webhookSecret: WEBHOOK_SECRET,
      repositoryOverrides: this.auditFaults ? { audit: this.auditFaults } : {},
    });

    this.api = new SubscriptionApiClient(app);
    this.webhooks = new WebhookSimulator(this.api, WEBHOOK_SECRET);
    this.dbCheck = new DbVerifier(this.repos);
    this.providerCheck = new ProviderVerifier(this.provider);
    this.invariants = new InvariantChecker(this.repos, this.provider, this.api, this.dbCheck);
    this.steps = new SubscriptionSteps(this.api, this.clock, this.provider, this.dbCheck, this.invariants);
  }

  static create(options: TestContextOptions = {}): TestContext {
    return new TestContext(options);
  }

  faults(): FaultInjectingAuditRepository {
    if (!this.auditFaults) {
      throw new Error('Create the context with { injectAuditFaults: true } to inject faults');
    }
    return this.auditFaults;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Gives every test in the file its own TestContext and runs the invariant checks after each test.
 * Usage: `const ctx = useTestContext();` then `const { api, dbCheck } = ctx();` inside a test.
 */
export function useTestContext(options: TestContextOptions = {}): () => TestContext {
  let current: TestContext | undefined;

  beforeEach(() => {
    current = TestContext.create(options);
  });

  afterEach(async () => {
    const context = current;
    current = undefined;
    if (!context) {
      return;
    }
    try {
      await context.invariants.assertAll();
    } finally {
      context.close();
    }
  });

  return () => {
    if (!current) {
      throw new Error('The test context is only available inside a test');
    }
    return current;
  };
}
