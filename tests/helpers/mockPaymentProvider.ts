import { ChargeRequest, ChargeResult, PaymentProvider, ProviderTimeoutError } from '../../src/paymentProvider';

type Outcome = 'succeed' | 'decline' | 'timeout';

/**
 * Fake payment company.
 *  - The test decides the answer: willSucceed() / willDecline() / willTimeout()
 *  - Every call is recorded in `calls`, so tests can check exactly what was sent.
 */
export class MockPaymentProvider implements PaymentProvider {
  calls: ChargeRequest[] = [];
  private queue: Outcome[] = [];
  private defaultOutcome: Outcome = 'succeed';
  private declineReason = 'card_declined';

  willSucceed() { this.queue.push('succeed'); return this; }
  willDecline(reason = 'card_declined') { this.declineReason = reason; this.queue.push('decline'); return this; }
  willTimeout() { this.queue.push('timeout'); return this; }
  alwaysDecline() { this.defaultOutcome = 'decline'; return this; }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    const outcome = this.queue.shift() ?? this.defaultOutcome;
    if (outcome === 'timeout') throw new ProviderTimeoutError('provider did not answer');
    if (outcome === 'decline') return { result: 'declined', reason: this.declineReason };
    return { result: 'succeeded', chargeId: `ch_${this.calls.length}` };
  }
}
