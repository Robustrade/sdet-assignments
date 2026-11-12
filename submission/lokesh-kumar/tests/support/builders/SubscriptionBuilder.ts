import type { PlanId, SubscriptionState } from '../../../src/domain/types.js';
import type { SubscriptionBody } from '../clients/ApiClient.js';
import { aCreateSubscriptionRequest } from './SubscriptionRequestBuilder.js';
import type { TestEnvironment } from '../TestEnvironment.js';

/**
 * Scenario builder: puts a subscription into a target state by driving the REAL API and the
 * fake provider (never by editing the database), then clears the provider's call history so
 * the test starts from a clean slate.
 *
 *   const sub = await env.aSubscription().onPlan('pro').inState('past_due').create();
 */
export class SubscriptionBuilder {
  private readonly env: TestEnvironment;
  private plan: PlanId = 'pro';
  private target: SubscriptionState = 'trialing';
  private customer = 'cust_001';

  constructor(env: TestEnvironment) {
    this.env = env;
  }

  onPlan(plan: PlanId): this {
    this.plan = plan;
    return this;
  }
  forCustomer(id: string): this {
    this.customer = id;
    return this;
  }
  inState(state: SubscriptionState): this {
    this.target = state;
    return this;
  }

  async create(): Promise<SubscriptionBody> {
    const { api, provider } = this.env;
    const hasTrial = this.plan === 'pro';
    if (this.target === 'trialing' && !hasTrial) {
      throw new Error('Only plans with a trial can be left in the trialing state');
    }

    // Declined first charge => past_due. Otherwise charges succeed.
    if (this.target === 'past_due') provider.alwaysDecline();
    else provider.alwaysSucceed();

    const created = await api.createSubscription(
      aCreateSubscriptionRequest().forCustomer(this.customer).onPlan(this.plan).build(),
    );
    if (created.status !== 201) throw new Error(`Setup failed: ${JSON.stringify(created)}`);
    const id = created.body.id;

    // Plans with a trial are only billed when the trial ends.
    if (hasTrial && (this.target === 'active' || this.target === 'past_due')) {
      await api.billSubscription(id);
    }
    if (this.target === 'canceled') {
      await api.cancelSubscription(id);
    }

    provider.reset();
    const final = await api.getSubscription(id);
    if (final.body.status !== this.target) {
      throw new Error(`Setup reached ${final.body.status}, wanted ${this.target}`);
    }
    return final.body;
  }
}
