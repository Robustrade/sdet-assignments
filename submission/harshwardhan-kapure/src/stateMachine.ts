import { SubscriptionStatus, SubscriptionTrigger } from './types';

export interface TransitionDefinition {
  from: SubscriptionStatus;
  trigger: SubscriptionTrigger;
  to: SubscriptionStatus;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromStatus: SubscriptionStatus,
    public readonly trigger: SubscriptionTrigger
  ) {
    super(`Invalid transition from '${fromStatus}' on trigger '${trigger}'`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * The exact 7 legal lifecycle transitions for a subscription.
 */
export const ALLOWED_TRANSITIONS: readonly TransitionDefinition[] = Object.freeze([
  { from: 'trialing', trigger: 'TRIAL_SUCCEEDED', to: 'active' },
  { from: 'trialing', trigger: 'TRIAL_FAILED', to: 'past_due' },
  { from: 'active', trigger: 'RECURRING_FAILED', to: 'past_due' },
  { from: 'past_due', trigger: 'RETRY_SUCCEEDED', to: 'active' },
  { from: 'past_due', trigger: 'RETRIES_EXHAUSTED', to: 'canceled' },
  { from: 'active', trigger: 'CANCEL', to: 'canceled' },
  { from: 'trialing', trigger: 'CANCEL', to: 'canceled' }
]);

const TRANSITION_TABLE: Readonly<Record<SubscriptionStatus, Partial<Record<SubscriptionTrigger, SubscriptionStatus>>>> =
  ALLOWED_TRANSITIONS.reduce(
    (table, edge) => {
      table[edge.from][edge.trigger] = edge.to;
      return table;
    },
    {
      trialing: {},
      active: {},
      past_due: {},
      canceled: {}
    } as Record<SubscriptionStatus, Partial<Record<SubscriptionTrigger, SubscriptionStatus>>>
  );

/**
 * Enforces legal subscription lifecycle transitions from a single explicit transition table.
 */
export class SubscriptionStateMachine {
  canTransition(from: SubscriptionStatus, trigger: SubscriptionTrigger): boolean {
    return TRANSITION_TABLE[from]?.[trigger] !== undefined;
  }

  transition(from: SubscriptionStatus, trigger: SubscriptionTrigger): SubscriptionStatus {
    const next = TRANSITION_TABLE[from]?.[trigger];
    if (!next) {
      throw new InvalidTransitionError(from, trigger);
    }
    return next;
  }
}
