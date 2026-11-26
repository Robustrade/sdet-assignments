import crypto from 'node:crypto';
import { CreateSubscriptionRequest, PlanId, SubscriptionRecord, SubscriptionStatus } from '../../../src/types';

/**
 * Fluent builder for subscription API payloads and repository seed records.
 */
export class SubscriptionBuilder {
  private id = `sub_${crypto.randomUUID().slice(0, 8)}`;
  private customerId = 'cust_001';
  private plan: PlanId | string = 'pro';
  private paymentMethodId = 'pm_test_visa_4242';
  private status: SubscriptionStatus = 'trialing';
  private trialEndsAt: string | null = new Date(Date.now() + 14 * 86_400_000).toISOString();
  private retryCount = 0;

  withId(id: string): this {
    this.id = id;
    return this;
  }

  forCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withPlan(plan: PlanId | string): this {
    this.plan = plan;
    return this;
  }

  basic(): this {
    this.plan = 'basic';
    this.trialEndsAt = null;
    return this;
  }

  pro(): this {
    this.plan = 'pro';
    this.trialEndsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  withStatus(status: SubscriptionStatus): this {
    this.status = status;
    return this;
  }

  withRetryCount(retryCount: number): this {
    this.retryCount = retryCount;
    return this;
  }

  buildRequest(): CreateSubscriptionRequest {
    return {
      customer_id: this.customerId,
      plan: this.plan,
      payment_method_id: this.paymentMethodId
    };
  }

  buildRecord(): SubscriptionRecord {
    const now = new Date().toISOString();
    return {
      id: this.id,
      customer_id: this.customerId,
      plan: (this.plan === 'basic' ? 'basic' : 'pro') as PlanId,
      status: this.status,
      payment_method_id: this.paymentMethodId,
      trial_ends_at: this.trialEndsAt,
      retry_count: this.retryCount,
      created_at: now,
      updated_at: now
    };
  }
}

export function aSubscription(): SubscriptionBuilder {
  return new SubscriptionBuilder();
}
