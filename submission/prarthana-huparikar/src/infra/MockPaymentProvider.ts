import { PaymentProvider, ChargeRequest, ChargeResult, ChargeOutcome } from '../domain/PaymentProvider';

export type MockOutcome = ChargeOutcome | 'timeout';

/**
 * Test double for PaymentProvider. Configurable per-test outcome
 * (success / decline / timeout) and records every call so tests can assert
 * on call count and exact arguments, not just "something was called".
 */
export class MockPaymentProvider implements PaymentProvider {
  private outcome: MockOutcome = 'success';
  public readonly calls: ChargeRequest[] = [];

  setOutcome(outcome: MockOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);

    if (this.outcome === 'timeout') {
      throw new Error('provider_timeout');
    }
    if (this.outcome === 'decline') {
      return { outcome: 'decline' };
    }
    return { outcome: 'success', providerChargeId: `ch_${request.reference}` };
  }

  callCount(): number {
    return this.calls.length;
  }

  reset(): void {
    this.calls.length = 0;
    this.outcome = 'success';
  }
}
