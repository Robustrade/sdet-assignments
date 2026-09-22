import { describe, expect, it } from 'vitest';
import { transition } from '../src/subscription-state';

describe('Subscription State Machine', () => {
  it('moves trialing subscription to active when payment succeeds', () => {
    const result = transition('trialing', 'PAYMENT_SUCCEEDED');

    expect(result).toBe('active');
  });

  it('moves trialing subscription to past_due when payment fails', () => {
    const result = transition('trialing', 'PAYMENT_FAILED');

    expect(result).toBe('past_due');
  });

  it('does not allow a canceled subscription to become active', () => {
    expect(() =>
      transition('canceled', 'PAYMENT_SUCCEEDED'),
    ).toThrow('Invalid subscription transition');
  });

  it('moves active subscription to past_due when payment fails', () => {
  const result = transition('active', 'PAYMENT_FAILED');

  expect(result).toBe('past_due');
});

it('moves past_due subscription to active when retry succeeds', () => {
  const result = transition('past_due', 'PAYMENT_SUCCEEDED');

  expect(result).toBe('active');
});

it('moves past_due subscription to canceled when retries are exhausted', () => {
  const result = transition('past_due', 'RETRIES_EXHAUSTED');

  expect(result).toBe('canceled');
});

it('moves active subscription to canceled when customer cancels', () => {
  const result = transition('active', 'CANCEL');

  expect(result).toBe('canceled');
});

it('moves trialing subscription to canceled when customer cancels', () => {
  const result = transition('trialing', 'CANCEL');

  expect(result).toBe('canceled');
});

it('does not allow canceled subscription to move to past_due', () => {
  expect(() =>
    transition('canceled', 'PAYMENT_FAILED'),
  ).toThrow('Invalid subscription transition');
});
});