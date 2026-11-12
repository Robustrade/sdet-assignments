import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/providers/paymentProvider';
import type { MockPaymentProvider } from '../mocks/mockPaymentProvider';

/** Checks how the service talked to the payment provider: how often and with which arguments. */
export class ProviderVerifier {
  constructor(private readonly provider: MockPaymentProvider) {}

  get calls(): readonly ChargeRequest[] {
    return this.provider.calls;
  }

  expectNoCharges(): void {
    expect(this.provider.calls, 'the payment provider should not have been called').toEqual([]);
  }

  expectChargeCount(count: number): void {
    expect(this.provider.calls, `the payment provider should have been called ${count} time(s)`).toHaveLength(count);
  }

  /** Exactly one call, with exactly these arguments. */
  expectOnlyCharge(expected: ChargeRequest): void {
    expect(this.provider.calls).toEqual([expected]);
  }

  expectLastCharge(expected: ChargeRequest): void {
    expect(this.provider.calls[this.provider.calls.length - 1]).toEqual(expected);
  }
}
