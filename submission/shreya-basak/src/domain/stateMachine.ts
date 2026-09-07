import { SubscriptionState, WebhookEventType } from './types';

export type TransitionTrigger =
  | { kind: 'api_cancel' }
  | { kind: 'webhook'; type: WebhookEventType }
  | { kind: 'retries_exhausted' };

type TriggerKey = WebhookEventType | 'api_cancel' | 'retries_exhausted';

const TRANSITIONS: Record<SubscriptionState, Partial<Record<TriggerKey, SubscriptionState>>> = {
  trialing: {
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    api_cancel: 'canceled',
  },
  active: {
    'payment.failed': 'past_due',
    api_cancel: 'canceled',
  },
  past_due: {
    'payment.succeeded': 'active',
    retries_exhausted: 'canceled',
  },
  canceled: {},
};

function triggerKey(trigger: TransitionTrigger): TriggerKey {
  return trigger.kind === 'webhook' ? trigger.type : trigger.kind;
}

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionState, trigger: TransitionTrigger) {
    super(`Invalid transition from '${from}' via trigger ${JSON.stringify(trigger)}`);
    this.name = 'InvalidTransitionError';
  }
}

export class SubscriptionStateMachine {

  static nextState(from: SubscriptionState, trigger: TransitionTrigger): SubscriptionState | null {
    const key = triggerKey(trigger);
    const next = TRANSITIONS[from][key];
    if (next) return next;

    if (trigger.kind === 'webhook') return null;
    if (trigger.kind === 'api_cancel' && from === 'canceled') return null;

    throw new InvalidTransitionError(from, trigger);
  }
}
