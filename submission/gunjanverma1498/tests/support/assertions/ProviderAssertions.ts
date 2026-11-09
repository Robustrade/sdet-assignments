import { expect } from 'vitest';
import type { FakePaymentProvider } from '../doubles/FakePaymentProvider';

/**
 * Assertions about how the service interacted with the payment provider.
 *
 * Proves the "called exactly once per genuine billing attempt, with the right
 * arguments, and not called at all otherwise" expectations — not merely that
 * "something was called".
 */
export class ProviderAssertions {
  constructor(private readonly provider: FakePaymentProvider) {}

  chargeCount(expected: number): this {
    expect(this.provider.callCount, 'payment provider charge count').toBe(expected);
    return this;
  }

  wasNotCharged(): this {
    return this.chargeCount(0);
  }

  chargedExactlyOnce(): this {
    return this.chargeCount(1);
  }

  lastChargeMatched(expected: {
    customerId?: string;
    paymentMethodId?: string;
    amount?: number;
    currency?: string;
    idempotencyKey?: string;
  }): this {
    const call = this.provider.lastCall();
    expect(call, 'expected at least one charge call').toBeDefined();
    if (expected.customerId !== undefined) expect(call!.customerId).toBe(expected.customerId);
    if (expected.paymentMethodId !== undefined)
      expect(call!.paymentMethodId).toBe(expected.paymentMethodId);
    if (expected.amount !== undefined) expect(call!.amount).toBe(expected.amount);
    if (expected.currency !== undefined) expect(call!.currency).toBe(expected.currency);
    if (expected.idempotencyKey !== undefined)
      expect(call!.idempotencyKey).toBe(expected.idempotencyKey);
    return this;
  }
}
