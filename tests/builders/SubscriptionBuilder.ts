/**
 * Builder Pattern - Subscription Builder
 *
 * Provides fluent API for constructing subscription test data.
 * Makes tests more readable and reduces setup boilerplate.
 */

import { Subscription, PlanType, SubscriptionStatus } from '../../src/domain/subscription/types';
import { randomUUID } from 'crypto';

export class SubscriptionBuilder {
  private subscription: Partial<Subscription> = {
    status: 'trialing',
    plan: 'pro',
    created_at: new Date(),
  };

  withId(id: string): this {
    this.subscription.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.subscription.customer_id = customerId;
    return this;
  }

  withPlan(plan: PlanType): this {
    this.subscription.plan = plan;
    return this;
  }

  withStatus(status: SubscriptionStatus): this {
    this.subscription.status = status;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.subscription.payment_method_id = paymentMethodId;
    return this;
  }

  withTrialEndAt(trialEndAt: Date): this {
    this.subscription.trial_end_at = trialEndAt;
    return this;
  }

  withCanceledAt(canceledAt: Date): this {
    this.subscription.canceled_at = canceledAt;
    return this;
  }

  withCreatedAt(createdAt: Date): this {
    this.subscription.created_at = createdAt;
    return this;
  }

  /**
   * Build a trialing subscription (default)
   */
  trialing(): this {
    this.subscription.status = 'trialing';
    this.subscription.trial_end_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    return this;
  }

  /**
   * Build an active subscription
   */
  active(): this {
    this.subscription.status = 'active';
    return this;
  }

  /**
   * Build a past_due subscription
   */
  pastDue(): this {
    this.subscription.status = 'past_due';
    return this;
  }

  /**
   * Build a canceled subscription
   */
  canceled(): this {
    this.subscription.status = 'canceled';
    this.subscription.canceled_at = new Date();
    return this;
  }

  /**
   * Build the subscription object
   */
  build(): Subscription {
    // Apply defaults for required fields
    return {
      id: this.subscription.id || `sub_${randomUUID()}`,
      customer_id: this.subscription.customer_id || 'cust_default',
      plan: this.subscription.plan || 'pro',
      status: this.subscription.status || 'trialing',
      payment_method_id: this.subscription.payment_method_id || 'pm_test_visa_4242',
      created_at: this.subscription.created_at || new Date(),
      trial_end_at: this.subscription.trial_end_at,
      canceled_at: this.subscription.canceled_at,
    };
  }
}
