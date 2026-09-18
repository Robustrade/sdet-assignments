import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/payments/payment-provider';
import type { FakePaymentProvider } from '../doubles/fake-payment-provider';

export interface ExpectedCharge {
  customerId?: string;
  paymentMethodId?: string;
  amountCents?: number;
  currency?: string;
  subscriptionId?: string;
  invoiceId?: string;
  attempt?: number;
  idempotencyKey?: string;
}

/**
 * Interaction verification for the mocked provider: call count *and* arguments.
 * "Something was called" is not an assertion anyone should trust with money.
 */
export class ProviderAssertions {
  private constructor(private readonly provider: FakePaymentProvider) {}

  static on(provider: FakePaymentProvider): ProviderAssertions {
    return new ProviderAssertions(provider);
  }

  wasCalledTimes(expected: number): this {
    expect(this.provider.callCount, 'payment provider call count').toBe(expected);
    return this;
  }

  wasNeverCalled(): this {
    return this.wasCalledTimes(0);
  }

  wasCalledTimesForSubscription(subscriptionId: string, expected: number): this {
    expect(
      this.provider.callsForSubscription(subscriptionId).length,
      `provider calls for ${subscriptionId}`
    ).toBe(expected);
    return this;
  }

  /** Asserts on activity after a mark(), without discarding earlier history. */
  wasCalledTimesSince(mark: number, expected: number): this {
    expect(this.provider.callsSince(mark).length, `provider calls since mark ${mark}`).toBe(expected);
    return this;
  }

  wasNotCalledSince(mark: number): this {
    return this.wasCalledTimesSince(mark, 0);
  }

  lastChargeMatched(expected: ExpectedCharge): this {
    const call = this.provider.lastCall;
    expect(call, 'expected at least one provider call').toBeDefined();
    return this.assertCall(call!, expected);
  }

  chargeAtMatched(index: number, expected: ExpectedCharge): this {
    const call = this.provider.calls[index];
    expect(call, `expected a provider call at index ${index}`).toBeDefined();
    return this.assertCall(call!, expected);
  }

  /** Every attempt must carry its own idempotency key; no key may be reused. */
  usedUniqueIdempotencyKeys(): this {
    const keys = this.provider.idempotencyKeys();
    expect(new Set(keys).size, 'distinct idempotency keys').toBe(keys.length);
    return this;
  }

  private assertCall(call: ChargeRequest, expected: ExpectedCharge): this {
    if (expected.customerId !== undefined) expect(call.customerId).toBe(expected.customerId);
    if (expected.paymentMethodId !== undefined)
      expect(call.paymentMethodId).toBe(expected.paymentMethodId);
    if (expected.amountCents !== undefined) expect(call.amountCents).toBe(expected.amountCents);
    if (expected.currency !== undefined) expect(call.currency).toBe(expected.currency);
    if (expected.subscriptionId !== undefined)
      expect(call.reference.subscriptionId).toBe(expected.subscriptionId);
    if (expected.invoiceId !== undefined) expect(call.reference.invoiceId).toBe(expected.invoiceId);
    if (expected.attempt !== undefined) expect(call.reference.attempt).toBe(expected.attempt);
    if (expected.idempotencyKey !== undefined)
      expect(call.idempotencyKey).toBe(expected.idempotencyKey);
    return this;
  }
}
