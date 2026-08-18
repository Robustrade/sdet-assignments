import { test, expect } from '@playwright/test';
import {
  SubscriptionStateMachine,
  InvalidSubscriptionTransitionError,
} from '../../src/domain/subscription-state';

test.describe('Subscription State Machine', () => {
  test('should transition trialing to active when first payment succeeds', () => {
    const stateMachine = new SubscriptionStateMachine('trialing');

    const status = stateMachine.transition('trial_charge_succeeded');

    expect(status).toBe('active');
  });

  test('should transition trialing to past_due when first payment fails', () => {
    const stateMachine = new SubscriptionStateMachine('trialing');

    const status = stateMachine.transition('trial_charge_failed');

    expect(status).toBe('past_due');
  });

  test('should transition active to past_due when recurring payment fails', () => {
    const stateMachine = new SubscriptionStateMachine('active');

    const status = stateMachine.transition('recurring_charge_failed');

    expect(status).toBe('past_due');
  });

  test('should recover past_due to active when retry succeeds', () => {
    const stateMachine = new SubscriptionStateMachine('past_due');

    const status = stateMachine.transition('retry_charge_succeeded');

    expect(status).toBe('active');
  });

  test('should transition past_due to canceled when retries are exhausted', () => {
    const stateMachine = new SubscriptionStateMachine('past_due');

    const status = stateMachine.transition('retries_exhausted');

    expect(status).toBe('canceled');
  });

  test('should allow customer to cancel an active subscription', () => {
    const stateMachine = new SubscriptionStateMachine('active');

    const status = stateMachine.transition('customer_cancelled');

    expect(status).toBe('canceled');
  });

  test('should allow customer to cancel a trialing subscription', () => {
    const stateMachine = new SubscriptionStateMachine('trialing');

    const status = stateMachine.transition('customer_cancelled');

    expect(status).toBe('canceled');
  });

  test('should reject canceled to active transition', () => {
    const stateMachine = new SubscriptionStateMachine('canceled');

    expect(() =>
      stateMachine.transition('trial_charge_succeeded'),
    ).toThrow(InvalidSubscriptionTransitionError);
  });

  test('should reject active to active transition', () => {
    const stateMachine = new SubscriptionStateMachine('active');

    expect(() =>
      stateMachine.transition('trial_charge_succeeded'),
    ).toThrow(InvalidSubscriptionTransitionError);
  });
});
