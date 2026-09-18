import { MutableClock } from '../../../src/domain/clock';
import { SequentialIdGenerator } from '../../../src/domain/ids';
import { PlanCatalog } from '../../../src/domain/plan-policy';
import { createBillingSystem, type BillingSystem } from '../../../src/system';
import type { Repositories } from '../../../src/persistence/repositories';
import type { InvoiceResource, SubscriptionApiClient } from '../clients/subscription-api-client';
import type { WebhookApiClient } from '../clients/webhook-api-client';
import { ApiClientFactory } from '../clients/api-client-factory';
import { CustomerBuilder } from '../builders/customer-builder';
import { WebhookEventBuilder } from '../builders/webhook-event-builder';
import { FakePaymentProvider } from '../doubles/fake-payment-provider';
import { RecordingNotifier } from '../doubles/recording-notifier';
import type { CustomerRecord } from '../../../src/persistence/records';
import { SubscriptionScenarios } from './subscription-scenarios';

export interface TestEnvironmentOptions {
  startAt?: Date;
  webhookSecret?: string;
  seedCustomers?: CustomerRecord[];
  plans?: PlanCatalog;
}

/**
 * TEST FIXTURE / composition root for a single test.
 *
 * Builds the real object graph with two nodes replaced — the payment provider
 * and the clock — seeds reference data, and exposes the clients, doubles and
 * repositories a scenario needs. Every test gets a brand-new instance, so no
 * test can observe another's data (the usual source of false positives).
 */
export class TestEnvironment {
  readonly system: BillingSystem;
  readonly clock: MutableClock;
  readonly provider: FakePaymentProvider;
  readonly notifier: RecordingNotifier;
  readonly repos: Repositories;
  readonly api: SubscriptionApiClient;
  readonly webhooks: WebhookApiClient;
  readonly scenarios: SubscriptionScenarios;

  private constructor(options: TestEnvironmentOptions) {
    this.clock = new MutableClock(options.startAt ?? new Date('2026-01-01T00:00:00.000Z'));
    this.provider = new FakePaymentProvider();
    this.notifier = new RecordingNotifier();

    this.system = createBillingSystem({
      provider: this.provider,
      clock: this.clock,
      notifier: this.notifier,
      ids: new SequentialIdGenerator(),
      plans: options.plans ?? PlanCatalog.default(),
      webhookSecret: options.webhookSecret ?? 'whsec_test_secret'
    });

    this.repos = this.system.repos;
    const clients = ApiClientFactory.forInProcessApp(this.system.app, this.system.signatures);
    this.api = clients.subscriptions;
    this.webhooks = clients.webhooks;
    this.scenarios = new SubscriptionScenarios(this);

    for (const customer of options.seedCustomers ?? TestEnvironment.defaultCustomers()) {
      this.seedCustomer(customer);
    }
  }

  static create(options: TestEnvironmentOptions = {}): TestEnvironment {
    WebhookEventBuilder.resetIds();
    return new TestEnvironment(options);
  }

  static defaultCustomers(): CustomerRecord[] {
    return [
      CustomerBuilder.aCustomer().withId('cust_001').withPaymentMethods('pm_test_visa_4242').build(),
      CustomerBuilder.aCustomer()
        .withId('cust_002')
        .withEmail('grace@example.com')
        .withPaymentMethods('pm_test_mastercard_5555')
        .build()
    ];
  }

  seedCustomer(customer: CustomerRecord): CustomerRecord {
    return this.repos.customers.insert(customer);
  }

  advanceDays(days: number): void {
    this.clock.advanceDays(days);
  }

  /** Drives the scheduled billing job directly (the HTTP route does the same). */
  runBillingCycle() {
    return this.system.billingRunner.run();
  }

  async invoicesOf(subscriptionId: string): Promise<InvoiceResource[]> {
    const res = await this.api.listInvoices(subscriptionId);
    return res.body.data;
  }

  async latestInvoice(subscriptionId: string): Promise<InvoiceResource> {
    const invoices = await this.invoicesOf(subscriptionId);
    const latest = invoices[invoices.length - 1];
    if (!latest) throw new Error(`No invoice exists for ${subscriptionId}`);
    return latest;
  }

  webhookSecretSignature(body: string): string {
    return this.system.signatures.sign(body);
  }
}
