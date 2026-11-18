
import { getNextStatus } from '../../src/state-machine/subscription-state';

describe('Subscription State Machine', () => {

  test('trialing subscription becomes active on payment success', () => {
    expect(getNextStatus('trialing', 'PAYMENT_SUCCEEDED'))
      .toBe('active');
  });

  test('trialing subscription becomes past_due on payment failure', () => {
    expect(getNextStatus('trialing', 'PAYMENT_FAILED'))
      .toBe('past_due');
  });

  test('active subscription becomes past_due on payment failure', () => {
    expect(getNextStatus('active', 'PAYMENT_FAILED'))
      .toBe('past_due');
  });

  test('past_due subscription becomes active on payment success', () => {
    expect(getNextStatus('past_due', 'PAYMENT_SUCCEEDED'))
      .toBe('active');
  });

  test('active subscription can be canceled', () => {
    expect(getNextStatus('active', 'CANCEL'))
      .toBe('canceled');
  });

  test('trialing subscription can be canceled', () => {
    expect(getNextStatus('trialing', 'CANCEL'))
      .toBe('canceled');
  });

  test('canceled subscription cannot become active', () => {
    expect(() => getNextStatus('canceled', 'PAYMENT_SUCCEEDED'))
      .toThrow('Invalid transition');
  });

  it('should cancel a past_due subscription when retries are exhausted', () => {
  expect(getNextStatus('past_due', 'RETRIES_EXHAUSTED'))
    .toBe('canceled');
  });

  it('should reject payment success for a canceled subscription', () => {
  expect(() => getNextStatus('canceled', 'PAYMENT_SUCCEEDED'))
    .toThrow('Invalid transition: canceled -> PAYMENT_SUCCEEDED');
  });

});
