import { PlanTier } from './Plan';

export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

type TransitionAction = 'paymentSucceeded' | 'paymentFailed' | 'cancel' | 'expireRetries';

const STATE_TRANSITIONS: Record<SubscriptionState, Partial<Record<TransitionAction, SubscriptionState>>> = {
  trialing: {
    paymentSucceeded: 'active',
    paymentFailed: 'past_due',
    cancel: 'canceled'
  },
  active: {
    paymentSucceeded: 'active',
    paymentFailed: 'past_due',
    cancel: 'canceled'
  },
  past_due: {
    paymentSucceeded: 'active',
    paymentFailed: 'past_due',
    expireRetries: 'canceled',
    cancel: 'canceled'
  },
  canceled: {}
};

/**
 * Domain entity representing a subscription and its lifecycle.
 * Enforces allowed state transitions via an explicit transition table.
 */
export class Subscription {
  public readonly id: string;
  public readonly customerId: string;
  public plan: PlanTier;
  private _state: SubscriptionState;

  /**
   * Create a new Subscription domain object.
   * @param id - Unique subscription identifier
   * @param customerId - Associated customer id
   * @param plan - Plan tier (e.g. 'basic' | 'pro')
   * @param initialState - Initial lifecycle state
   */
  constructor(id: string, customerId: string, plan: PlanTier, initialState: SubscriptionState = 'trialing') {
    this.id = id;
    this.customerId = customerId;
    this.plan = plan;
    this._state = initialState;
  }

  get state(): SubscriptionState {
    return this._state;
  }

  /**
   * Perform a guarded state transition according to the transition table.
   * Throws an error if the transition is invalid for the current state.
   * @param action - Transition action to apply
   */
  private performTransition(action: TransitionAction): void {
    const nextState = STATE_TRANSITIONS[this._state][action];
    if (!nextState) {
      throw new Error(`Invalid transition: cannot apply '${action}' from '${this._state}'`);
    }
    this._state = nextState;
  }

  /**
   * Handle a successful payment event; may move the subscription to `active`.
   */
  public paymentSucceeded(): void {
    this.performTransition('paymentSucceeded');
  }

  /**
   * Handle a failed payment event; moves to `past_due` when allowed.
   */
  public paymentFailed(): void {
    this.performTransition('paymentFailed');
  }

  /**
   * Record a refund event. Refunds do not change lifecycle state unless
   * business logic elsewhere enforces a transition. Throws for canceled subs.
   */
  public paymentRefunded(): void {
    if (this._state === 'canceled') {
      throw new Error(`Invalid transition: cannot process refund for canceled subscription`);
    }
    // Refund does not change the lifecycle state by itself.
  }

  /**
   * Cancel the subscription; this is an irreversible transition to `canceled`.
   */
  public cancel(): void {
    this.performTransition('cancel');
  }

  /**
   * Mark that retries have been exhausted and transition to `canceled` where allowed.
   */
  public expireRetries(): void {
    this.performTransition('expireRetries');
  }

  /**
   * Change the subscription's plan. Disallowed for `canceled` subscriptions.
   * @param newPlan - New `PlanTier` to apply
   */
  public changePlan(newPlan: PlanTier): void {
    if (this._state === 'canceled') {
      throw new Error('Invalid transition: cannot change plan for canceled subscription');
    }
    this.plan = newPlan;
  }

  public toJSON() {
    return {
      id: this.id,
      customerId: this.customerId,
      plan: this.plan,
      state: this.state
    };
  }
}
