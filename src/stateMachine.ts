/**
 * The subscription lifecycle as ONE table.
 * If a move is not in this table, it is not allowed. Simple as that.
 */
export type Status = 'trialing' | 'active' | 'past_due' | 'canceled';
export type LifecycleEvent = 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'RETRIES_EXHAUSTED' | 'CANCEL';

export const ALLOWED_MOVES: Record<Status, Partial<Record<LifecycleEvent, Status>>> = {
  trialing: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', CANCEL: 'canceled' },
  active: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', CANCEL: 'canceled' }, // active->active = renewal
  past_due: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', RETRIES_EXHAUSTED: 'canceled' }, // past_due->past_due = retry failed
  canceled: {}, // final state: nothing can move it
};

export class InvalidTransitionError extends Error {
  constructor(from: Status, event: LifecycleEvent) {
    super(`Not allowed: ${event} when status is ${from}`);
  }
}

export function nextStatus(current: Status, event: LifecycleEvent): Status {
  const next = ALLOWED_MOVES[current][event];
  if (!next) throw new InvalidTransitionError(current, event);
  return next;
}
