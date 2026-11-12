import type { SubscriptionStatus } from '../../src/domain/types';

/**
 * The 7 allowed transitions from the brief, written out by hand.
 * Tests check the service against this list, never against the service's own table.
 */
export const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [SubscriptionStatus, SubscriptionStatus]> = [
  ['trialing', 'active'],
  ['trialing', 'past_due'],
  ['active', 'past_due'],
  ['past_due', 'active'],
  ['past_due', 'canceled'],
  ['active', 'canceled'],
  ['trialing', 'canceled'],
];

export function isAllowedTransition(from: SubscriptionStatus | null, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);
}
