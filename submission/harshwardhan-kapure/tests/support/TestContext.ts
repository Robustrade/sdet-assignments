import { Express } from 'express';
import { createApp } from '../../src/app';
import { InMemoryRepository } from '../../src/repository';
import { DEFAULT_WEBHOOK_SECRET } from '../../src/signature';
import { CustomerRecord, PlanId, SubscriptionRecord } from '../../src/types';
import { ApiClient } from './ApiClient';
import { MockPaymentProvider } from './MockPaymentProvider';
import { aCustomer, aSubscription, CustomerBuilder, SubscriptionBuilder } from './builders';

export interface TestContextOptions {
  webhookSecret?: string;
  maxRetries?: number;
}

/**
 * Per-test isolated environment assembling a fresh repository, mock provider, Express app, and API client.
 */
export class TestContext {
  public readonly repo: InMemoryRepository;
  public readonly provider: MockPaymentProvider;
  public readonly app: Express;
  public readonly api: ApiClient;
  public readonly webhookSecret: string;

  private constructor(options: TestContextOptions = {}) {
    this.repo = new InMemoryRepository();
    this.provider = new MockPaymentProvider();
    this.webhookSecret = options.webhookSecret ?? DEFAULT_WEBHOOK_SECRET;
    this.app = createApp({
      repository: this.repo,
      paymentProvider: this.provider,
      webhookSecret: this.webhookSecret,
      maxRetries: options.maxRetries ?? 3
    });
    this.api = new ApiClient(this.app);
  }

  static create(options?: TestContextOptions): TestContext {
    return new TestContext(options);
  }

  seedCustomer(customize?: (builder: CustomerBuilder) => CustomerBuilder): CustomerRecord {
    const builder = customize ? customize(aCustomer()) : aCustomer();
    return this.repo.saveCustomer(builder.build());
  }

  seedSubscription(customize?: (builder: SubscriptionBuilder) => SubscriptionBuilder): SubscriptionRecord {
    const builder = customize ? customize(aSubscription()) : aSubscription();
    return this.repo.saveSubscription(builder.buildRecord());
  }

  async createSubscriptionViaApi(
    customer: CustomerRecord,
    plan: PlanId = 'pro',
    paymentMethodId: string = customer.payment_methods[0]
  ): Promise<SubscriptionRecord> {
    const req = aSubscription()
      .forCustomer(customer.id)
      .withPlan(plan)
      .withPaymentMethod(paymentMethodId)
      .buildRequest();
    const res = await this.api.createSubscription(req);
    if (res.status !== 201) {
      throw new Error(`Expected 201 creating subscription, got ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  /**
   * Provisions an active subscription through real creation + charge flows (never bypassing invariants).
   */
  async givenActiveSubscription(customer: CustomerRecord, plan: PlanId = 'pro'): Promise<SubscriptionRecord> {
    this.provider.respondWithSuccess();
    const sub = await this.createSubscriptionViaApi(customer, plan);
    if (sub.status === 'active') {
      this.provider.clearHistory();
      return sub;
    }
    const billRes = await this.api.billSubscription(sub.id);
    if (billRes.status !== 200 || billRes.body.subscription.status !== 'active') {
      throw new Error(`Failed to activate subscription ${sub.id}`);
    }
    this.provider.clearHistory();
    return billRes.body.subscription;
  }

  /**
   * Provisions a past_due subscription through real creation + failed charge(s).
   */
  async givenPastDueSubscription(
    customer: CustomerRecord,
    failedAttempts: number = 1
  ): Promise<SubscriptionRecord> {
    const sub = await this.createSubscriptionViaApi(customer, 'pro');
    this.provider.respondWithDecline();
    let current = sub;
    for (let i = 0; i < failedAttempts; i++) {
      const billRes = await this.api.billSubscription(sub.id);
      if (billRes.status !== 200) {
        throw new Error(`Failed to move subscription ${sub.id} to past_due`);
      }
      current = billRes.body.subscription;
    }
    this.provider.clearHistory();
    return current;
  }
}
