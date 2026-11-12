import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/payment/PaymentProvider.js';
import type { FakePaymentProvider } from '../doubles/FakePaymentProvider.js';

/** Assertions about what the service sent to the (fake) payment provider. */
export class ProviderVerifier {
  private readonly provider: FakePaymentProvider;

  constructor(provider: FakePaymentProvider) {
    this.provider = provider;
  }

  expectNoCharges(): void {
    expect(this.provider.calls).toHaveLength(0);
  }
  expectChargeCount(count: number): void {
    expect(this.provider.calls).toHaveLength(count);
  }
  /** Asserts the exact arguments of the most recent charge, not just that one happened. */
  expectLastCharge(expected: ChargeRequest): void {
    expect(this.provider.lastCall).toEqual(expected);
  }
}
