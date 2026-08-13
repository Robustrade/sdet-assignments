import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/payment/PaymentProviderPort.js';
import type { FakePaymentProvider } from '../FakePaymentProvider.js';

export class ProviderAssertions {
  static expectNeverCalled(provider: FakePaymentProvider): void {
    expect(provider.calls, 'expected the payment provider to never be called').toHaveLength(0);
  }

  static expectChargedExactlyOnceWith(
    provider: FakePaymentProvider,
    expected: Partial<ChargeRequest>,
  ): void {
    expect(provider.calls.length, `expected exactly one charge call, got ${provider.calls.length}`).toBe(1);
    const call = provider.calls[0]!;
    for (const [key, value] of Object.entries(expected)) {
      expect(
        call[key as keyof ChargeRequest],
        `expected charge argument "${key}" to be ${JSON.stringify(value)}`,
      ).toEqual(value);
    }
  }

  static expectChargedTimes(provider: FakePaymentProvider, times: number): void {
    expect(provider.calls.length, `expected ${times} charge call(s), got ${provider.calls.length}`).toBe(times);
  }

  static expectNoFurtherCalls(provider: FakePaymentProvider, baseline: number): void {
    expect(provider.calls.length, `expected no further charge calls beyond ${baseline}, got ${provider.calls.length}`).toBe(baseline);
  }
}