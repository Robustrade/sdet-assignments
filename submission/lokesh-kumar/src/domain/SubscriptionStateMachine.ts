export type SubscriptionState = "trialing" | "active" | "past_due" | "canceled";
export type SubscriptionEvent =
  | "charge_succeeded"
  | "charge_failed"
  | "retries_exhausted"
  | "cancel";

export const ALL_EVENTS: readonly SubscriptionEvent[] = [
  "charge_succeeded",
  "charge_failed",
  "retries_exhausted",
  "cancel",
];

type TransitionTable = Record<
  SubscriptionState,
  Partial<Record<SubscriptionEvent, SubscriptionState>>
>;

// Single source of truth for the lifecycle. Anything not listed is illegal.
const TRANSITIONS: Readonly<TransitionTable> = Object.freeze({
  trialing: { charge_succeeded: "active", charge_failed: "past_due", cancel: "canceled" },
  active: { charge_failed: "past_due", cancel: "canceled" },
  past_due: { charge_succeeded: "active", retries_exhausted: "canceled" },
  canceled: {},
});

export type TransitionResult =
  | { ok: true; state: SubscriptionState }
  | { ok: false; from: SubscriptionState; event: SubscriptionEvent; reason: string };

export class SubscriptionStateMachine {
  transition(from: SubscriptionState, event: SubscriptionEvent): TransitionResult {
    const to = TRANSITIONS[from][event];
    if (!to) {
      return { ok: false, from, event, reason: `Illegal transition: ${from} --${event}-->` };
    }
    return { ok: true, state: to };
  }
}