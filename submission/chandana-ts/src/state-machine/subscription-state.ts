
import { SubscriptionStatus } from '../models/subscription';

type SubscriptionEvent =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'RETRIES_EXHAUSTED'
  | 'CANCEL';

const transitions: Record<
  SubscriptionStatus,
  Partial<Record<SubscriptionEvent, SubscriptionStatus>>
> = {
  trialing: {
    PAYMENT_SUCCEEDED: 'active',
    PAYMENT_FAILED: 'past_due',
    CANCEL: 'canceled'
  },

  active: {
    PAYMENT_FAILED: 'past_due',
    CANCEL: 'canceled'
  },

    past_due: {
        PAYMENT_SUCCEEDED: 'active',
        PAYMENT_FAILED: 'past_due',
        RETRIES_EXHAUSTED: 'canceled'
        },

  canceled: {}
};

export function getNextStatus(
  currentStatus: SubscriptionStatus,
  event: SubscriptionEvent
): SubscriptionStatus {
  const nextStatus = transitions[currentStatus][event];

  if (!nextStatus) {
    throw new Error(
      `Invalid transition: ${currentStatus} -> ${event}`
    );
  }

  return nextStatus;
}
