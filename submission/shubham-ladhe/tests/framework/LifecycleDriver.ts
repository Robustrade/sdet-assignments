import { SubscriptionStatus } from '../../src/domain/types';
import { expectOk } from './api/SubscriptionApiClient';
import { aSignupRequest } from './builders';
import type { TestHarness } from './TestHarness';

export interface ArrangedSubscription {
  subscriptionId: string;
}

export interface ArrangedWithInvoice extends ArrangedSubscription {
  /** The invoice that matters for the state: the open one for trialing/past_due, the paid one for active. */
  invoiceId: string;
}

/**
 * "Given" steps: put a subscription into a lifecycle state using only real behaviour - API calls,
 * provider outcomes, billing runs - never by writing rows directly. So arranging a state also
 * exercises the path that leads to it. Actions under test (billing, webhooks) live on the harness.
 */
export class LifecycleDriver {
  constructor(private readonly env: TestHarness) {}

  /** basic plan, inside its trial, nothing billed yet (no invoice). */
  async trialing(): Promise<ArrangedSubscription> {
    const subscription = expectOk(await this.env.api.create(aSignupRequest().onBasicPlan().build()));
    return { subscriptionId: subscription.id };
  }

  /**
   * pro plan whose signup charge timed out: still `trialing`, with an open invoice and an attempt
   * whose outcome is unknown. The provider has not said yet whether money moved.
   */
  async signupChargeOutcomeUnknown(): Promise<ArrangedWithInvoice> {
    this.env.gateway.willTimeout();
    return this.signUpOnPro();
  }

  /** pro plan, charged successfully at signup. */
  async active(): Promise<ArrangedWithInvoice> {
    this.env.gateway.willSucceed();
    return this.signUpOnPro();
  }

  /** pro plan whose signup charge was declined. */
  async pastDue(): Promise<ArrangedWithInvoice> {
    this.env.gateway.willDecline('insufficient_funds');
    return this.signUpOnPro();
  }

  /** past_due with exactly one attempt left in the plan's retry budget. */
  async pastDueOnLastRetry(): Promise<ArrangedWithInvoice> {
    const arranged = await this.pastDue();
    const { maxAttempts } = this.env.plans.get('pro');
    for (let failedSoFar = 1; failedSoFar < maxAttempts - 1; failedSoFar++) {
      this.env.gateway.willDecline('insufficient_funds');
      await this.env.billAtNextRetry(arranged.invoiceId);
    }
    return arranged;
  }

  /** Canceled by the customer while active (a paid invoice is on record). */
  async canceled(): Promise<ArrangedWithInvoice> {
    const arranged = await this.active();
    expectOk(await this.env.api.cancel(arranged.subscriptionId));
    return arranged;
  }

  /** Canceled because the retry budget ran out (the invoice is uncollectible). */
  async canceledByExhaustedRetries(): Promise<ArrangedWithInvoice> {
    const arranged = await this.pastDueOnLastRetry();
    this.env.gateway.willDecline('insufficient_funds');
    await this.env.billAtNextRetry(arranged.invoiceId);
    return arranged;
  }

  /**
   * One representative per state, each with an invoice so payment webhooks have a target.
   * That is why `trialing` maps to a signup whose charge outcome is still unknown.
   */
  async inState(status: SubscriptionStatus): Promise<ArrangedWithInvoice> {
    switch (status) {
      case 'trialing':
        return this.signupChargeOutcomeUnknown();
      case 'active':
        return this.active();
      case 'past_due':
        return this.pastDue();
      case 'canceled':
        return this.canceledByExhaustedRetries();
    }
  }

  private async signUpOnPro(): Promise<ArrangedWithInvoice> {
    const subscription = expectOk(await this.env.api.create(aSignupRequest().onProPlan().build()));
    return { subscriptionId: subscription.id, invoiceId: this.env.latestInvoiceId(subscription.id) };
  }
}
