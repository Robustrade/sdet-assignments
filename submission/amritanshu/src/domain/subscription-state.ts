    export type SubscriptionState =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type SubscriptionEvent =
  | "payment.succeeded"
  | "payment.failed"
  | "cancel";

const TRANSITIONS: Record<
  SubscriptionState,
  Partial<Record<SubscriptionEvent, SubscriptionState>>
> = {
  trialing: {
    "payment.succeeded": "active",
    "payment.failed": "past_due",
    cancel: "canceled",
  },

  active: {
    "payment.failed": "past_due",
    cancel: "canceled",
  },

  past_due: {
    "payment.succeeded": "active",
    cancel: "canceled",
  },

  canceled: {},
};

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    public readonly currentState: SubscriptionState,
    public readonly event: SubscriptionEvent,
  ) {
    super(
      `Invalid subscription transition: ${currentState} + ${event}`,
    );

    this.name = "InvalidSubscriptionTransitionError";
  }
}

export class SubscriptionStateMachine {
  constructor(private readonly currentState: SubscriptionState) {}

  transition(event: SubscriptionEvent): SubscriptionState {
    const nextState = TRANSITIONS[this.currentState][event];

    if (!nextState) {
      throw new InvalidSubscriptionTransitionError(
        this.currentState,
        event,
      );
    }

    return nextState;
  }
}