import type { ChargeRequest } from '../../../src/providers/PaymentProvider';
import type { MockPaymentProvider } from '../doubles/MockPaymentProvider';

/** Intent-level assertions on what the service sent to the payment provider. */
export class ProviderAssertions {
  constructor(private readonly provider: MockPaymentProvider) {}

  expectNoCharges(): void {
    expect(this.provider.charge).not.toHaveBeenCalled();
    expect(this.provider.calls).toEqual([]);
  }

  expectCallCount(count: number): void {
    expect(this.provider.charge).toHaveBeenCalledTimes(count);
  }

  /** Exactly one provider call, and its arguments equal `expected` (every field, no extras). */
  expectChargedOnce(expected: ChargeRequest): void {
    this.expectCallCount(1);
    expect(this.provider.calls[0]).toEqual(expected);
  }

  /** Arguments of the n-th call (0-based), compared field by field. */
  expectChargeAt(index: number, expected: ChargeRequest): void {
    expect(this.provider.calls[index]).toEqual(expected);
  }

  /** The distinct idempotency keys the provider has seen, in order of first use (a resend repeats its key). */
  idempotencyKeys(): string[] {
    return [...new Set(this.provider.calls.map((call) => call.idempotencyKey))];
  }

  /** Every call carries a different idempotency key, i.e. each call is a separate billing attempt. */
  expectDistinctIdempotencyKeys(): void {
    const keys = this.provider.calls.map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  }
}
