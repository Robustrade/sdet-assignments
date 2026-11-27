
import { SubscriptionStateMachine } from '../src/services/subscriptionStateMachine';

describe('SubscriptionStateMachine', () => {
  test('should allow trialing to active', () => {
    expect(
      SubscriptionStateMachine.transition('trialing', 'active')
    ).toBe('active');
  });

  test('should allow active to past_due', () => {
    expect(
      SubscriptionStateMachine.transition('active', 'past_due')
    ).toBe('past_due');
  });

  test('should allow past_due to active', () => {
    expect(
      SubscriptionStateMachine.transition('past_due', 'active')
    ).toBe('active');
  });

  test('should allow cancellation', () => {
    expect(
      SubscriptionStateMachine.transition('active', 'canceled')
    ).toBe('canceled');
  });

  test('should reject transition from canceled', () => {
    expect(() =>
      SubscriptionStateMachine.transition('canceled', 'active')
    ).toThrow('Invalid subscription transition');
  });

  test('should reject trialing directly to canceled? No, cancellation is allowed', () => {
    expect(
      SubscriptionStateMachine.transition('trialing', 'canceled')
    ).toBe('canceled');
  });
});
