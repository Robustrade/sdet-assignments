import type { SubscriptionStatus } from '../models/subscription';

export type SubscriptionTransition =
  | 'trialing->active'
  | 'trialing->past_due'
  | 'trialing->canceled'
  | 'active->past_due'
  | 'active->canceled'
  | 'past_due->active'
  | 'past_due->canceled';

export interface SubscriptionStateMachine {
  canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean;
  transition(from: SubscriptionStatus, to: SubscriptionStatus): SubscriptionTransition;
}

export class DefaultSubscriptionStateMachine implements SubscriptionStateMachine {
  private static readonly validTransitions: Record<
    SubscriptionStatus,
    readonly SubscriptionStatus[]
  > = {
    trialing: ['active', 'past_due', 'canceled'],
    active: ['past_due', 'canceled'],
    past_due: ['active', 'canceled'],
    canceled: [],
  };

  canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
    return (DefaultSubscriptionStateMachine.validTransitions[from] ?? []).includes(to);
  }

  transition(from: SubscriptionStatus, to: SubscriptionStatus): SubscriptionTransition {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid subscription transition: ${from} -> ${to}`);
    }

    return `${from}->${to}` as SubscriptionTransition;
  }
}

export const subscriptionStateMachine = new DefaultSubscriptionStateMachine();
