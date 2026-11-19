import { canPaymentTransition, isUnresolved } from '../../src/domain/payment-state-machine';

/** U-02: final payment outcomes can never be overwritten by a stale event. */
describe('U-02 payment-attempt transition table', () => {
  test.each([
    ['pending', 'succeeded', true],
    ['pending', 'failed', true],
    ['pending', 'timed_out', true],
    ['timed_out', 'succeeded', true],
    ['timed_out', 'failed', true],
    ['succeeded', 'refunded', true],
    ['succeeded', 'failed', false], // late failure must not regress a success
    ['failed', 'succeeded', false], // a new attempt is required instead
    ['refunded', 'succeeded', false],
    ['timed_out', 'pending', false],
  ] as const)('%s -> %s allowed = %s', (from, to, allowed) => {
    expect(canPaymentTransition(from, to)).toBe(allowed);
  });

  test('only pending and timed_out are unresolved', () => {
    expect(isUnresolved('pending')).toBe(true);
    expect(isUnresolved('timed_out')).toBe(true);
    expect(isUnresolved('succeeded')).toBe(false);
    expect(isUnresolved('failed')).toBe(false);
  });
});
