import type { PlanId } from './plans';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface SubscriptionRecord {
  readonly id: string;
  readonly customerId: string;
  readonly plan: PlanId;
  readonly status: SubscriptionStatus;
  readonly priceCents: number;
  readonly currency: string;
  /** Provider payment method token, kept so later billing can charge it. Never returned by the API. */
  readonly paymentMethodId: string;
  /** ISO-8601 timestamps. */
  readonly trialEndsAt: string;
  readonly createdAt: string;
}
