export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export class SubscriptionStateMachine {
  private static readonly allowedTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    trialing: ['active', 'past_due', 'canceled'],
    active: ['past_due', 'canceled'],
    past_due: ['active', 'canceled'],
    canceled: [], // Terminal state
  };

  public static canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
    const validNextStates = this.allowedTransitions[from];
    return validNextStates ? validNextStates.includes(to) : false;
  }

  public static transition(current: SubscriptionStatus, target: SubscriptionStatus): SubscriptionStatus {
    if (!this.canTransition(current, target)) {
      throw new Error(`Invalid lifecycle transition from '${current}' to '${target}' is strictly forbidden.`);
    }
    return target;
  }
}