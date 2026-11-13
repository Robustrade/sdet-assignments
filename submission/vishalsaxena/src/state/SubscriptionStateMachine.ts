
import { SubscriptionStatus } from '../models/Subscription';

const allowedTransitions: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  trialing: ['active', 'past_due', 'canceled'],
  active: ['past_due', 'canceled'],
  past_due: ['active', 'canceled'],
  canceled: []
};

export function canTransition(
  currentStatus: SubscriptionStatus,
  nextStatus: SubscriptionStatus
): boolean {
  return allowedTransitions[currentStatus].includes(nextStatus);
}

export function transitionSubscription(
  currentStatus: SubscriptionStatus,
  nextStatus: SubscriptionStatus
): SubscriptionStatus {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new Error(
      `Invalid subscription transition: ${currentStatus} -> ${nextStatus}`
    );
  }

  return nextStatus;
}
