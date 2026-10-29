import { createService } from '../../../src/app';
import type { BillingRunEntry, BillingScheduler } from '../../../src/services/BillingScheduler';
import type { InvoiceRecord, InvoiceStatus } from '../../../src/domain/Invoice';
import type { SubscriptionRecord, SubscriptionStatus } from '../../../src/domain/Subscription';
import { InMemoryAuditLogRepository } from '../../../src/persistence/InMemoryAuditLogRepository';
import { InMemoryCustomerRepository } from '../../../src/persistence/InMemoryCustomerRepository';
import { InMemoryInvoiceRepository } from '../../../src/persistence/InMemoryInvoiceRepository';
import { InMemorySubscriptionRepository } from '../../../src/persistence/InMemorySubscriptionRepository';
import { InMemoryWebhookEventRepository } from '../../../src/persistence/InMemoryWebhookEventRepository';
import { SequentialIdGenerator } from '../../../src/support/IdGenerator';
import { BillingApiClient } from '../clients/BillingApiClient';
import { anInvoiceRecord } from '../builders/InvoiceRecordBuilder';
import { aSubscriptionRecord } from '../builders/SubscriptionRecordBuilder';
import { FakeClock } from '../doubles/FakeClock';
import { MockPaymentProvider } from '../doubles/MockPaymentProvider';
import { PersistenceAssertions } from '../assertions/PersistenceAssertions';
import { ProviderAssertions } from '../assertions/ProviderAssertions';
import { withLatency } from '../doubles/withLatency';
import { WebhookSimulator } from '../webhooks/WebhookSimulator';

/** The shared secret the service under test is configured with. Test-only value. */
export const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';

export interface TestEnvironmentOptions {
  /** Every repository call made by the service yields to the event loop first (see `withLatency`). */
  slowStorage?: boolean;
}

/**
 * Builds a fresh, fully isolated service instance per test: new repositories,
 * new clock, new payment provider double, new ID sequence. Nothing is shared
 * between environments, so there is no cleanup and no stale data.
 */
export class TestEnvironment {
  readonly clock = new FakeClock();
  readonly subscriptions = new InMemorySubscriptionRepository();
  readonly invoices = new InMemoryInvoiceRepository();
  readonly webhookEvents = new InMemoryWebhookEventRepository();
  readonly auditLog = new InMemoryAuditLogRepository();
  readonly provider = new MockPaymentProvider();
  readonly api: BillingApiClient;
  private readonly scheduler: BillingScheduler;
  readonly webhooks: WebhookSimulator;
  readonly persistence: PersistenceAssertions;
  readonly providerCalls: ProviderAssertions;

  private constructor(options: TestEnvironmentOptions) {
    // The service may see slow storage; the assertions below always read the original repositories.
    const storage = options.slowStorage ? withLatency : <T extends object>(repository: T): T => repository;
    const { app, billingScheduler } = createService({
      subscriptions: storage(this.subscriptions),
      customers: new InMemoryCustomerRepository(['cust_001', 'cust_002']),
      invoices: storage(this.invoices),
      webhookEvents: storage(this.webhookEvents),
      auditLog: storage(this.auditLog),
      clock: this.clock,
      ids: new SequentialIdGenerator(),
      paymentProvider: this.provider,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
    this.scheduler = billingScheduler;
    this.api = new BillingApiClient(app);
    this.webhooks = new WebhookSimulator(this.api, TEST_WEBHOOK_SECRET);
    this.persistence = new PersistenceAssertions({
      subscriptions: this.subscriptions,
      invoices: this.invoices,
      webhookEvents: this.webhookEvents,
      auditLog: this.auditLog,
    });
    this.providerCalls = new ProviderAssertions(this.provider);
  }

  static create(options: TestEnvironmentOptions = {}): TestEnvironment {
    return new TestEnvironment(options);
  }

  /**
   * One billing run at the fake clock's current time: charges whatever is due (trial end, recurring
   * period, retry) and reports what it did. The service has no HTTP endpoint for this.
   */
  runBilling(): Promise<BillingRunEntry[]> {
    return this.scheduler.runDue();
  }

  /**
   * Arrange-only helpers: write rows straight into the repositories so a scenario can start in an
   * arbitrary state. The behavior under test never goes through these.
   */
  async seedSubscription(record: SubscriptionRecord): Promise<void> {
    await this.subscriptions.save(record);
  }

  async seedInvoice(record: InvoiceRecord): Promise<void> {
    await this.invoices.save(record);
  }

  /**
   * Seeds the `pro` subscription `sub_seed_001` in `status` plus one invoice per entry of
   * `invoiceStatuses` (`inv_seed_001`, `inv_seed_002`, ... = attempts 1, 2, ...), at the plan price.
   * Example: `seedBilling('past_due', ['failed', 'pending'])` is a subscription awaiting its retry.
   */
  async seedBilling(status: SubscriptionStatus, invoiceStatuses: InvoiceStatus[] = []): Promise<void> {
    await this.seedSubscription(aSubscriptionRecord().inStatus(status).build());
    for (const [index, invoiceStatus] of invoiceStatuses.entries()) {
      const attempt = index + 1;
      await this.seedInvoice(
        anInvoiceRecord()
          .withId(`inv_seed_${String(attempt).padStart(3, '0')}`)
          .attempt(attempt)
          .withStatus(invoiceStatus)
          .build(),
      );
    }
  }
}
