import { expect } from 'vitest';
import type { Subscription, SubscriptionState } from '../../../src/domain/types.js';

export class SubscriptionAssertions {
  static expectState(subscription: Subscription | undefined, expected: SubscriptionState): void {
    if (!subscription) {
      throw new Error(`expected subscription to exist with state "${expected}", but it was not found`);
    }
    expect(subscription.state).toBe(expected);
  }

  static expectPlan(subscription: Subscription | undefined, expected: string): void {
    if (!subscription) {
      throw new Error(`expected subscription to exist with plan "${expected}", but it was not found`);
    }
    expect(subscription.plan).toBe(expected);
  }

  static expectCancellationIrreversible(subscription: Subscription | undefined): void {
    this.expectState(subscription, 'canceled');
  }
}