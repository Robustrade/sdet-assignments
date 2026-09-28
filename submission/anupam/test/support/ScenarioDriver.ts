import type { SubscriptionDto } from '../../src/http/presenters';
import type { Customer } from '../../src/domain/types';
import { aCustomer, type CustomerBuilder } from './builders/CustomerBuilder';
import { aSubscriptionRequest } from './builders/SubscriptionRequestBuilder';
import type { TestEnvironment } from './TestEnvironment';

/**
 * "Given" steps. Puts subscriptions into a state by driving the REAL flows
 * (API + billing run + provider mock) - never by writing rows directly - so
 * the starting state is always one the system can genuinely reach.
 */
export class ScenarioDriver {
  constructor(private readonly env: TestEnvironment) {}

  customer(builder: CustomerBuilder = aCustomer()): Customer {
    return this.env.seedCustomer(builder.build());
  }

  async trialingSubscription(customer = this.customer()): Promise<SubscriptionDto> {
    const res = await this.env.api.createSubscription(
      aSubscriptionRequest().forCustomer(customer).onPlan('basic').build(),
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('trialing');
    return res.body;
  }

  async activeSubscription(plan: 'basic' | 'pro' = 'pro'): Promise<SubscriptionDto> {
    if (plan === 'pro') {
      this.env.provider.willSucceed();
      const res = await this.env.api.createSubscription(
        aSubscriptionRequest().forCustomer(this.customer()).onPlan('pro').build(),
      );
      expect(res.body.status).toBe('active');
      return res.body;
    }
    const sub = await this.trialingSubscription();
    this.env.clock.advanceDays(14);
    this.env.provider.willSucceed();
    await this.env.runBilling(sub.id);
    return this.refresh(sub.id, 'active');
  }

  async pastDueSubscription(): Promise<SubscriptionDto> {
    const sub = await this.trialingSubscription();
    this.env.clock.advanceDays(14);
    this.env.provider.willDecline();
    await this.env.runBilling(sub.id);
    return this.refresh(sub.id, 'past_due');
  }

  async canceledSubscription(): Promise<SubscriptionDto> {
    const sub = await this.activeSubscription('pro');
    const res = await this.env.api.cancelSubscription(sub.id);
    expect(res.body.status).toBe('canceled');
    return res.body;
  }

  /** Trial ended, provider timed out -> outcome unknown, invoice open with a pending attempt. */
  async trialWithPendingCharge(): Promise<SubscriptionDto> {
    const sub = await this.trialingSubscription();
    this.env.clock.advanceDays(14);
    this.env.provider.willTimeout();
    await this.env.runBilling(sub.id);
    return this.refresh(sub.id, 'trialing');
  }

  /** Active subscription whose renewal charge timed out (pending). */
  async activeWithPendingRenewal(): Promise<SubscriptionDto> {
    const sub = await this.activeSubscription('pro');
    this.env.clock.advanceDays(30);
    this.env.provider.willTimeout();
    await this.env.runBilling(sub.id);
    return this.refresh(sub.id, 'active');
  }

  async refresh(id: string, expectStatus?: string): Promise<SubscriptionDto> {
    const res = await this.env.api.getSubscription(id);
    if (expectStatus) expect(res.body.status).toBe(expectStatus);
    return res.body;
  }
}
