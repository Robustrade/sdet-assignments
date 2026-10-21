/**
 * Subscription lifecycle as an explicit transition table.
 *
 * Any (state, event) pair that is NOT listed here is an illegal transition.
 * Self-loops (e.g. active --charge_succeeded--> active for a renewal) are
 * allowed events that leave the state unchanged.
 */
const TRANSITIONS = Object.freeze({
  trialing: { charge_succeeded: 'active', charge_failed: 'past_due', cancel: 'canceled' },
  active: { charge_succeeded: 'active', charge_failed: 'past_due', cancel: 'canceled' },
  past_due: { charge_succeeded: 'active', charge_failed: 'past_due', retries_exhausted: 'canceled' },
  canceled: {},
});

const STATES = Object.keys(TRANSITIONS);
const EVENTS = ['charge_succeeded', 'charge_failed', 'retries_exhausted', 'cancel'];

/** Returns the next state, or null when the transition is illegal. */
function nextState(currentState, event) {
  return TRANSITIONS[currentState]?.[event] ?? null;
}

module.exports = { STATES, EVENTS, nextState };
