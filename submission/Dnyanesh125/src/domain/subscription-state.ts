export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type SubscriptionEvent =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'recurring_charge_failed'
  | 'retry_charge_succeeded'
  | 'retries_exhausted'
  | 'customer_cancelled';

const transitions: Record<
  SubscriptionStatus,
  Partial<Record<SubscriptionEvent, SubscriptionStatus>>
> = {
  trialing: {
    trial_charge_succeeded: 'active',
    trial_charge_failed: 'past_due',
    customer_cancelled: 'canceled',
  },

  active: {
    recurring_charge_failed: 'past_due',
    customer_cancelled: 'canceled',
  },

  past_due: {
    retry_charge_succeeded: 'active',
    retries_exhausted: 'canceled',
  },

  canceled: {},
};

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    public readonly from: SubscriptionStatus,
    public readonly event: SubscriptionEvent,
  ) {
    super(
      `Invalid subscription transition: ${from} + ${event}`,
    );

    this.name = 'InvalidSubscriptionTransitionError';
  }
}

export class SubscriptionStateMachine {
  constructor(private currentStatus: SubscriptionStatus) {}

  get status(): SubscriptionStatus {
    return this.currentStatus;
  }

  transition(event: SubscriptionEvent): SubscriptionStatus {
    const nextStatus = transitions[this.currentStatus][event];

    if (!nextStatus) {
      throw new InvalidSubscriptionTransitionError(
        this.currentStatus,
        event,
      );
    }

    this.currentStatus = nextStatus;

    return this.currentStatus;
  }
}
