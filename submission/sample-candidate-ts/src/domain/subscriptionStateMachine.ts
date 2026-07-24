import { SubscriptionState } from "./types";

/**
 * State pattern (as a transition table): the single source of truth for
 * which lifecycle moves are legal. Both the API-driven cancel path and the
 * webhook-driven billing path must go through `transition()` — neither is
 * allowed to assign `.status` directly. That's what makes illegal
 * transitions structurally hard to reach instead of merely "not tested".
 */
export type TransitionTrigger =
  | "first_charge_succeeded"
  | "first_charge_failed"
  | "recurring_charge_succeeded"
  | "recurring_charge_failed"
  | "retries_exhausted"
  | "customer_canceled";

const TRANSITIONS: Record<SubscriptionState, Partial<Record<TransitionTrigger, SubscriptionState>>> = {
  trialing: {
    first_charge_succeeded: "active",
    first_charge_failed: "past_due",
    customer_canceled: "canceled",
  },
  active: {
    recurring_charge_failed: "past_due",
    customer_canceled: "canceled",
  },
  past_due: {
    recurring_charge_succeeded: "active",
    retries_exhausted: "canceled",
    customer_canceled: "canceled",
  },
  canceled: {},
};

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionState, trigger: TransitionTrigger) {
    super(`cannot apply "${trigger}" to a subscription in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

/** Returns the next state for (current state, trigger), or throws if illegal. */
export function transition(
  current: SubscriptionState,
  trigger: TransitionTrigger,
): SubscriptionState {
  const next = TRANSITIONS[current][trigger];
  if (!next) {
    throw new InvalidTransitionError(current, trigger);
  }
  return next;
}

export function canTransition(current: SubscriptionState, trigger: TransitionTrigger): boolean {
  return TRANSITIONS[current][trigger] !== undefined;
}
