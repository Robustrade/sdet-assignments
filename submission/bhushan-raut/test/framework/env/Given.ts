import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/provider/PaymentProvider';
import { aSubscriptionRequest, type PlanCode } from '../builders/SubscriptionRequestBuilder';
import type { SubscriptionStatus, SubscriptionView } from '../clients/contracts';
import type { TestEnvironment } from './TestEnvironment';

export interface WithPendingCharge {
  subscription: SubscriptionView;
  /** The charge the provider received but has not answered yet; its webhook is still to come. */
  charge: ChargeRequest;
}

/**
 * Drives a subscription into a starting state through the public API and the mock
 * provider — never by writing rows directly — so every precondition is itself a
 * real, invariant-checked path through the service.
 */
export class Given {
  constructor(private readonly env: TestEnvironment) {}

  async trialingSubscription(plan: PlanCode = 'basic'): Promise<SubscriptionView> {
    return this.create(plan, 'trialing');
  }

  async activeSubscription(): Promise<SubscriptionView> {
    this.env.provider.willSucceed();
    return this.create('pro', 'active');
  }

  async pastDueSubscription(): Promise<SubscriptionView> {
    this.env.provider.willDecline();
    return this.create('pro', 'past_due');
  }

  /** Pro signup whose first charge times out: still trialing, outcome to arrive by webhook. */
  async subscriptionWithPendingFirstCharge(): Promise<WithPendingCharge> {
    this.env.provider.willTimeout();
    const subscription = await this.create('pro', 'trialing');
    return { subscription, charge: this.env.provider.lastCall() };
  }

  /** Past-due subscription whose retry charge times out: outcome to arrive by webhook. */
  async pastDueWithPendingRetry(): Promise<WithPendingCharge> {
    const pastDue = await this.pastDueSubscription();
    this.env.provider.willTimeout();
    const run = await this.env.api.runBilling(pastDue.id);
    expect(run.body.result, 'retry should be left pending').toBe('pending');
    return { subscription: run.body.subscription, charge: this.env.provider.lastCall() };
  }

  private async create(plan: PlanCode, expected: SubscriptionStatus): Promise<SubscriptionView> {
    const customer = this.env.seedCustomer();
    const res = await this.env.api.create(aSubscriptionRequest().forCustomer(customer).onPlan(plan).build());
    expect(res.status, `create ${plan} subscription`).toBe(201);
    expect(res.body.status, `precondition: new ${plan} subscription`).toBe(expected);
    return res.body;
  }
}
