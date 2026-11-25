
import { describe, it, expect } from 'vitest';

import {
  SubscriptionStateMachine,
  InvalidSubscriptionTransitionError
} from '../../src/domain/subscription/SubscriptionStateMachine.js';

describe('SubscriptionStateMachine', () => {
  const stateMachine = new SubscriptionStateMachine();

  it('should transition trialing to active when payment succeeds', () => {
    expect(
      stateMachine.transition('trialing', 'PAYMENT_SUCCEEDED')
    ).toBe('active');
  });

  it('should transition trialing to past_due when payment fails', () => {
    expect(
      stateMachine.transition('trialing', 'PAYMENT_FAILED')
    ).toBe('past_due');
  });

  it('should transition active to past_due when recurring payment fails', () => {
    expect(
      stateMachine.transition('active', 'PAYMENT_FAILED')
    ).toBe('past_due');
  });

  it('should transition past_due to active when retry succeeds', () => {
    expect(
      stateMachine.transition('past_due', 'RETRY_SUCCEEDED')
    ).toBe('active');
  });

  it('should transition past_due to canceled when retries are exhausted', () => {
    expect(
      stateMachine.transition('past_due', 'RETRIES_EXHAUSTED')
    ).toBe('canceled');
  });

  it('should allow customer cancellation from trialing', () => {
    expect(
      stateMachine.transition('trialing', 'CUSTOMER_CANCELED')
    ).toBe('canceled');
  });

  it('should allow customer cancellation from active', () => {
    expect(
      stateMachine.transition('active', 'CUSTOMER_CANCELED')
    ).toBe('canceled');
  });

  it('should allow customer cancellation from past_due', () => {
    expect(
      stateMachine.transition('past_due', 'CUSTOMER_CANCELED')
    ).toBe('canceled');
  });

  it('should reject reactivation of canceled subscription', () => {
    expect(() => {
      stateMachine.transition('canceled', 'PAYMENT_SUCCEEDED');
    }).toThrow(InvalidSubscriptionTransitionError);
  });

  it('should reject retry success from trialing', () => {
    expect(() => {
      stateMachine.transition('trialing', 'RETRY_SUCCEEDED');
    }).toThrow(InvalidSubscriptionTransitionError);
  });

  it('should identify valid transitions without changing state', () => {
    expect(
      stateMachine.canTransition('trialing', 'PAYMENT_SUCCEEDED')
    ).toBe(true);
  });

  it('should identify invalid transitions', () => {
    expect(
      stateMachine.canTransition('canceled', 'PAYMENT_SUCCEEDED')
    ).toBe(false);
  });
});
