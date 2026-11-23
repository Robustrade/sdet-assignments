import type { ChargeRequest, ChargeResult, PaymentProvider } from '../../src/provider';

export type MockBehavior = 'success' | 'decline' | 'timeout';

/**
 * Configurable fake for the payment provider. Records every call so tests can
 * assert on call count AND arguments — not just that something was called.
 */
export class MockPaymentProvider implements PaymentProvider {
  calls: ChargeRequest[] = [];
  /** Per-call behaviors, consumed in order; the default applies afterwards. */
  behaviorQueue: MockBehavior[] = [];
  defaultBehavior: MockBehavior = 'success';
  declineReason = 'card_declined';

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);
    const behavior = this.behaviorQueue.shift() ?? this.defaultBehavior;
    if (behavior === 'success') return { outcome: 'success' };
    if (behavior === 'decline') return { outcome: 'decline', reason: this.declineReason };
    return { outcome: 'timeout' };
  }
}
