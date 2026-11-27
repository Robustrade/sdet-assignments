import { createServer, Server } from 'http';
import { buildBillingService, BillingService, ServiceDependencies } from '../../src/container';
import { PlanCatalog } from '../../src/domain/plans';
import { SqlDatabase } from '../../src/persistence/SqlDatabase';
import { SequentialIds } from '../../src/services/ids';
import { SubscriptionApiClient } from './api/SubscriptionApiClient';
import { WebhookSender } from './api/WebhookSender';
import { aCustomer, CustomerBuilder } from './builders';
import { FakeClock } from './doubles/FakeClock';
import { ScriptedPaymentGateway } from './doubles/ScriptedPaymentGateway';
import { SEED, WEBHOOK_SECRET } from './fixtures';
import { LifecycleDriver } from './LifecycleDriver';
import { DbSnapshot, TableName } from './verify/DbSnapshot';
import { InvariantChecker } from './verify/InvariantChecker';
import { SubscriptionRecord } from './verify/SubscriptionRecord';

export interface HarnessOptions {
  repositoryOverrides?: ServiceDependencies['repositoryOverrides'];
}

/**
 * Factory for an isolated world per test: fresh in-memory database, fake clock, scripted payment
 * provider, the real service wired to them, and the clients/verifiers tests use.
 * Nothing is shared between tests, so there is no stale data and nothing to clean up.
 *
 *   env.api        HTTP client for the subscription API
 *   env.webhooks   the provider's inbound webhooks (sign, forge, tamper, redeliver)
 *   env.gateway    the provider's outbound charge API (scripted double, records calls)
 *   env.given      "given" steps that put a subscription into a state
 *   env.stored(id) what the database holds for one subscription
 */
export class TestHarness {
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookSender;
  readonly given: LifecycleDriver;
  readonly invariants: InvariantChecker;
  readonly plans = new PlanCatalog();

  private constructor(
    readonly db: SqlDatabase,
    readonly clock: FakeClock,
    readonly gateway: ScriptedPaymentGateway,
    readonly service: BillingService,
    private readonly server: Server,
  ) {
    this.api = new SubscriptionApiClient(server);
    this.webhooks = new WebhookSender(server, WEBHOOK_SECRET, (id) => service.repos.invoices.findById(id));
    this.invariants = new InvariantChecker(service.repos, this.plans, gateway);
    this.given = new LifecycleDriver(this);
  }

  static async create(options: HarnessOptions = {}): Promise<TestHarness> {
    const db = await SqlDatabase.open();
    const clock = new FakeClock();
    const gateway = new ScriptedPaymentGateway(clock);
    const service = buildBillingService({
      db,
      gateway,
      clock,
      ids: new SequentialIds(),
      webhookSecret: WEBHOOK_SECRET,
      repositoryOverrides: options.repositoryOverrides,
    });
    // One listening server per harness (instead of supertest starting one per request).
    const server = createServer(service.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const harness = new TestHarness(db, clock, gateway, service, server);
    harness.seed([
      aCustomer().withId(SEED.alice.customerId).withCard(SEED.alice.card),
      aCustomer().withId(SEED.bob.customerId).withCard(SEED.bob.card).withCard(SEED.bob.expiredCard, { expired: true }),
    ]);
    return harness;
  }

  get repos(): BillingService['repos'] {
    return this.service.repos;
  }

  seed(customers: CustomerBuilder[]): void {
    for (const builder of customers) {
      const { customer, paymentMethods } = builder.build();
      this.repos.customers.insert(customer);
      paymentMethods.forEach((card) => this.repos.customers.insertPaymentMethod(card));
    }
  }

  // ---- time and billing (actions) ---------------------------------------

  runBilling(): ReturnType<BillingService['billing']['runDue']> {
    return this.service.billing.runDue();
  }

  /** Move time forward and let the billing job do whatever is now due. */
  async advanceDaysAndBill(days: number): Promise<void> {
    this.clock.advanceDays(days);
    await this.runBilling();
  }

  /** Jump the clock to the invoice's scheduled retry and run billing. */
  async billAtNextRetry(invoiceId: string): Promise<void> {
    const invoice = this.repos.invoices.findById(invoiceId);
    if (!invoice?.nextRetryAt) throw new Error(`Invoice ${invoiceId} has no retry scheduled`);
    this.clock.set(invoice.nextRetryAt);
    await this.runBilling();
  }

  /** Keep running scheduled retries until the invoice stops retrying. Returns each retry time used. */
  async retryUntilSettled(invoiceId: string): Promise<string[]> {
    const retryTimes: string[] = [];
    for (;;) {
      const invoice = this.repos.invoices.findById(invoiceId);
      if (invoice?.status !== 'open' || !invoice.nextRetryAt) return retryTimes;
      retryTimes.push(invoice.nextRetryAt);
      await this.billAtNextRetry(invoiceId);
    }
  }

  // ---- reading state (verification) -------------------------------------

  stored(subscriptionId: string): SubscriptionRecord {
    return SubscriptionRecord.load(this.repos, subscriptionId);
  }

  latestInvoiceId(subscriptionId: string): string {
    const invoice = this.stored(subscriptionId).latestInvoice;
    if (!invoice) throw new Error(`Subscription ${subscriptionId} has no invoice yet`);
    return invoice.id;
  }

  /** Field-by-field differences between GET /subscriptions/:id and the stored rows (empty = they agree). */
  async apiVsDbDifferences(subscriptionId: string): Promise<string[]> {
    const fromApi = await this.api.getOk(subscriptionId);
    return this.stored(subscriptionId).mismatchesWith(fromApi);
  }

  snapshot(): DbSnapshot {
    return DbSnapshot.take(this.db);
  }

  /** Tables whose contents differ from the snapshot (empty = the action persisted nothing). */
  tablesChangedSince(snapshot: DbSnapshot): TableName[] {
    return this.snapshot().changedSince(snapshot);
  }

  async close(): Promise<void> {
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.db.close();
  }
}
