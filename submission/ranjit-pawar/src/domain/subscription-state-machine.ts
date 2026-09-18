import type { SubscriptionState } from './types';

/**
 * Triggers are the only vocabulary that can move a subscription. Nothing in the
 * system writes `subscription.state` directly; every change goes through
 * SubscriptionStateMachine.transition().
 */
export type LifecycleTrigger =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'charge_succeeded'
  | 'charge_failed'
  | 'cancel_requested';

export interface TransitionContext {
  /** Retry attempts still available before the retry budget is exhausted. */
  retriesRemaining: number;
}

export type TransitionId =
  | 'TRIAL_ENDS_CHARGE_SUCCEEDED'
  | 'TRIAL_ENDS_CHARGE_FAILED'
  | 'TRIAL_CANCELED_BY_API'
  | 'ACTIVE_CHARGE_FAILED'
  | 'ACTIVE_CANCELED_BY_API'
  | 'PAST_DUE_RETRY_SUCCEEDED'
  | 'PAST_DUE_RETRY_FAILED_AGAIN'
  | 'PAST_DUE_RETRIES_EXHAUSTED'
  | 'ACTIVE_RENEWAL_SUCCEEDED';

export interface TransitionDefinition {
  readonly id: TransitionId;
  readonly from: SubscriptionState;
  readonly trigger: LifecycleTrigger;
  readonly to: SubscriptionState;
  /** Guards disambiguate two edges that share (from, trigger). */
  readonly guard?: (ctx: TransitionContext) => boolean;
  /** 'diagram' = in the assignment's lifecycle diagram, 'extension' = documented addition. */
  readonly origin: 'diagram' | 'extension';
  readonly description: string;
}

export type TransitionResult =
  | {
      ok: true;
      id: TransitionId;
      from: SubscriptionState;
      to: SubscriptionState;
      trigger: LifecycleTrigger;
    }
  | {
      ok: false;
      from: SubscriptionState;
      trigger: LifecycleTrigger;
      reason: 'TERMINAL_STATE' | 'ILLEGAL_TRANSITION';
    };

/**
 * STATE PATTERN, expressed as an explicit transition table.
 *
 * The table is the whole truth about the lifecycle: it is data, it is
 * enumerable (so tests can prove every edge is exercised), and any (state,
 * trigger) pair absent from it is structurally unreachable rather than
 * accidentally allowed.
 */
export const TRANSITION_TABLE: readonly TransitionDefinition[] = [
  {
    id: 'TRIAL_ENDS_CHARGE_SUCCEEDED',
    from: 'trialing',
    trigger: 'trial_charge_succeeded',
    to: 'active',
    origin: 'diagram',
    description: 'trial ends, first charge succeeds'
  },
  {
    id: 'TRIAL_ENDS_CHARGE_FAILED',
    from: 'trialing',
    trigger: 'trial_charge_failed',
    to: 'past_due',
    origin: 'diagram',
    description: 'trial ends, first charge fails'
  },
  {
    id: 'TRIAL_CANCELED_BY_API',
    from: 'trialing',
    trigger: 'cancel_requested',
    to: 'canceled',
    origin: 'diagram',
    description: 'customer/API cancel during trial'
  },
  {
    id: 'ACTIVE_CHARGE_FAILED',
    from: 'active',
    trigger: 'charge_failed',
    to: 'past_due',
    origin: 'diagram',
    description: 'recurring charge fails'
  },
  {
    id: 'ACTIVE_CANCELED_BY_API',
    from: 'active',
    trigger: 'cancel_requested',
    to: 'canceled',
    origin: 'diagram',
    description: 'customer/API cancel while active'
  },
  {
    id: 'PAST_DUE_RETRY_SUCCEEDED',
    from: 'past_due',
    trigger: 'charge_succeeded',
    to: 'active',
    origin: 'diagram',
    description: 'retry charge succeeds'
  },
  {
    id: 'PAST_DUE_RETRY_FAILED_AGAIN',
    from: 'past_due',
    trigger: 'charge_failed',
    to: 'past_due',
    guard: (ctx) => ctx.retriesRemaining > 1,
    origin: 'extension',
    description: 'retry charge fails but the retry budget is not exhausted yet'
  },
  {
    id: 'PAST_DUE_RETRIES_EXHAUSTED',
    from: 'past_due',
    trigger: 'charge_failed',
    to: 'canceled',
    guard: (ctx) => ctx.retriesRemaining <= 1,
    origin: 'diagram',
    description: 'retries exhausted'
  },
  {
    id: 'ACTIVE_RENEWAL_SUCCEEDED',
    from: 'active',
    trigger: 'charge_succeeded',
    to: 'active',
    origin: 'extension',
    description: 'recurring renewal charge succeeds; subscription stays active'
  }
];

export class SubscriptionStateMachine {
  constructor(private readonly table: readonly TransitionDefinition[] = TRANSITION_TABLE) {}

  get transitions(): readonly TransitionDefinition[] {
    return this.table;
  }

  transitionIds(): TransitionId[] {
    return this.table.map((t) => t.id);
  }

  isTerminal(state: SubscriptionState): boolean {
    return !this.table.some((t) => t.from === state);
  }

  /** Pure lookup: no side effects, no persistence, trivially unit-testable. */
  transition(
    from: SubscriptionState,
    trigger: LifecycleTrigger,
    ctx: TransitionContext = { retriesRemaining: 0 }
  ): TransitionResult {
    if (this.isTerminal(from)) {
      return { ok: false, from, trigger, reason: 'TERMINAL_STATE' };
    }
    const match = this.table.find(
      (t) => t.from === from && t.trigger === trigger && (t.guard ? t.guard(ctx) : true)
    );
    if (!match) {
      return { ok: false, from, trigger, reason: 'ILLEGAL_TRANSITION' };
    }
    return { ok: true, id: match.id, from, to: match.to, trigger };
  }
}

/**
 * Maps a billing outcome onto the correct trigger for the current state, so the
 * mapping lives in one place instead of at every call site that charges a card.
 */
export function triggerForChargeOutcome(
  state: SubscriptionState,
  outcome: 'succeeded' | 'failed'
): LifecycleTrigger {
  if (state === 'trialing') {
    return outcome === 'succeeded' ? 'trial_charge_succeeded' : 'trial_charge_failed';
  }
  return outcome === 'succeeded' ? 'charge_succeeded' : 'charge_failed';
}
