import type { Subscription, SubscriptionStatus } from '../domain/types';

/** The JSON shape returned by the API (snake_case, as in the brief). */
export interface SubscriptionDto {
  readonly id: string;
  readonly customer_id: string;
  readonly payment_method_id: string;
  readonly plan: string;
  readonly status: SubscriptionStatus;
  readonly trial_ends_at: string;
  readonly current_period_end: string | null;
  readonly canceled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  return {
    id: subscription.id,
    customer_id: subscription.customerId,
    payment_method_id: subscription.paymentMethodId,
    plan: subscription.plan,
    status: subscription.status,
    trial_ends_at: subscription.trialEndsAt,
    current_period_end: subscription.currentPeriodEnd,
    canceled_at: subscription.canceledAt,
    created_at: subscription.createdAt,
    updated_at: subscription.updatedAt,
  };
}
