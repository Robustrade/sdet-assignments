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

export class Subscription {
  public readonly id: string;
  public readonly customerId: string;
  public plan: PlanTier;
  private _state: SubscriptionState;

  constructor(id: string, customerId: string, plan: PlanTier, initialState: SubscriptionState = 'trialing') {
    this.id = id;
    this.customerId = customerId;
    this.plan = plan;
    this._state = initialState;
  }

  get state(): SubscriptionState {
    return this._state;
  }

  private performTransition(action: TransitionAction): void {
    const nextState = STATE_TRANSITIONS[this._state][action];
    if (!nextState) {
      throw new Error(`Invalid transition: cannot apply '${action}' from '${this._state}'`);
    }
    this._state = nextState;
  }

  public paymentSucceeded(): void {
    this.performTransition('paymentSucceeded');
  }

  public paymentFailed(): void {
    this.performTransition('paymentFailed');
  }

  public paymentRefunded(): void {
    if (this._state === 'canceled') {
      throw new Error(`Invalid transition: cannot process refund for canceled subscription`);
    }
    // Refund does not change the lifecycle state by itself.
  }

  public cancel(): void {
    this.performTransition('cancel');
  }

  public expireRetries(): void {
    this.performTransition('expireRetries');
  }

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
