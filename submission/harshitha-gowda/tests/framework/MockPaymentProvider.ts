import { ProviderTimeoutError, type ChargeRequest, type ChargeResult, type PaymentProvider } from '../../src/payment-provider.ts';

type Behavior = { kind: 'succeed' } | { kind: 'decline'; reason: string } | { kind: 'timeout' };

/** Test double: configurable outcomes + a full call record for later assertions. */
export class MockPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private queue: Behavior[] = [];
  private fallback: Behavior = { kind: 'succeed' };
  private refCounter = 0;

  /** Default behaviour for every call that has no queued one. */
  alwaysSucceed() { this.fallback = { kind: 'succeed' }; return this; }
  alwaysDecline(reason = 'card_declined') { this.fallback = { kind: 'decline', reason }; return this; }
  alwaysTimeout() { this.fallback = { kind: 'timeout' }; return this; }

  /** One-shot behaviours consumed in order, then back to the default. */
  nextSucceeds() { this.queue.push({ kind: 'succeed' }); return this; }
  nextDeclines(reason = 'card_declined') { this.queue.push({ kind: 'decline', reason }); return this; }
  nextTimesOut() { this.queue.push({ kind: 'timeout' }); return this; }

  clearCalls() { this.calls.length = 0; }
  get callCount() { return this.calls.length; }
  get lastCall(): ChargeRequest { return this.calls[this.calls.length - 1]; }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    const behavior = this.queue.shift() ?? this.fallback;
    if (behavior.kind === 'timeout') throw new ProviderTimeoutError();
    if (behavior.kind === 'decline') return { outcome: 'declined', reason: behavior.reason };
    return { outcome: 'succeeded', providerRef: `ch_mock_${++this.refCounter}` };
  }
}
