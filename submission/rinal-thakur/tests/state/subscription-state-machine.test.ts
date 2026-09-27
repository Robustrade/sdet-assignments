import { describe, expect, it } from 'vitest';
import {
  SubscriptionStateMachine,
  SubscriptionEvent
} from '../../src/domain/SubscriptionStateMachine';

describe('Subscription State Machine', () => {
  it('should transition trialing to active on payment success', () => {
    const stateMachine = new SubscriptionStateMachine();

    const result = stateMachine.transition(
      'trialing',
      'payment.succeeded'
    );

    expect(result).toBe('active');
  });

  it('should reject canceled to active transition', () => {
    const stateMachine = new SubscriptionStateMachine();

    expect(() =>
      stateMachine.transition(
        'canceled',
        'payment.succeeded'
      )
    ).toThrow();
  });

  it('should reject canceled to past_due transition', () => {
    const stateMachine = new SubscriptionStateMachine();

    expect(() =>
      stateMachine.transition(
        'canceled',
        'payment.failed'
      )
    ).toThrow();
  });

  it('should keep canceled as a terminal state', () => {
    const stateMachine = new SubscriptionStateMachine();

    const invalidEvents: SubscriptionEvent[] = [
      'payment.succeeded',
      'payment.failed',
      'payment.refunded',
      'customer.cancelled'
    ];

    invalidEvents.forEach((event) => {
      expect(() =>
        stateMachine.transition('canceled', event)
      ).toThrow();
    });
  });
});
