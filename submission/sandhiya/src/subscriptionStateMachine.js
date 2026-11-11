export const SubscriptionStatus = Object.freeze({
  TRIALING: 'trialing', ACTIVE: 'active', PAST_DUE: 'past_due', CANCELED: 'canceled',
});

// Explicit transition table: every status change must pass through this class.
const TRANSITIONS = Object.freeze({
  trialing: Object.freeze({
    api_cancel: 'canceled', payment_succeeded: 'active', payment_failed: 'past_due', trial_ended: 'past_due',
  }),
  active: Object.freeze({ api_cancel: 'canceled', payment_failed: 'past_due' }),
  past_due: Object.freeze({ payment_succeeded: 'active', retries_exhausted: 'canceled' }),
  canceled: Object.freeze({}),
});

export class SubscriptionStateMachine {
  transition(currentStatus, trigger) {
    const normalized = String(trigger).replace(/\./g, '_');
    const next = TRANSITIONS[currentStatus]?.[normalized];
    if (!next) throw new Error(`Invalid transition from ${currentStatus} on ${trigger}`);
    return next;
  }
  canTransition(currentStatus, trigger) {
    return Boolean(TRANSITIONS[currentStatus]?.[String(trigger).replace(/\./g, '_')]);
  }
}
