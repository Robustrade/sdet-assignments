import type { Subscription } from '../domain/types';

/**
 * Wire format for subscriptions. The API speaks snake_case (matching the
 * assignment's request/webhook examples) while the domain uses camelCase; this
 * is the single translation point between the two vocabularies.
 */
export function serializeSubscription(s: Subscription) {
  return {
    id: s.id,
    customer_id: s.customerId,
    plan: s.planId,
    payment_method_id: s.paymentMethodId,
    status: s.status,
    trial_end_at: s.trialEndAt,
    failed_charge_count: s.failedChargeCount,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}
