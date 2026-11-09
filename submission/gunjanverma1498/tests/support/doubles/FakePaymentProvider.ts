import {
  PaymentProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider,
} from '../../../src/payments/PaymentProvider';

export type ChargeOutcome = 'success' | 'decline' | 'timeout';

/**
 * Test double for the external payment provider.
 *
 * It implements the exact {@link PaymentProvider} seam the service depends on,
 * so no real network is involved. It (a) records every call for later assertion
 * on count and arguments, and (b) returns a configurable outcome so tests can
 * drive success / decline / timeout paths deterministically.
 *
 * A small queue of per-call outcomes lets a single scenario script a sequence
 * (e.g. "first charge declines, retry succeeds"); when the queue is empty it
 * falls back to the default outcome.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private defaultOutcome: ChargeOutcome;
  private readonly queue: ChargeOutcome[] = [];

  constructor(defaultOutcome: ChargeOutcome = 'success') {
    this.defaultOutcome = defaultOutcome;
  }

  /** Set the outcome returned when the per-call queue is empty. */
  willReturn(outcome: ChargeOutcome): this {
    this.defaultOutcome = outcome;
    return this;
  }

  /** Script the next charge outcome(s), consumed in order. */
  enqueue(...outcomes: ChargeOutcome[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  get callCount(): number {
    return this.calls.length;
  }

  lastCall(): ChargeRequest | undefined {
    return this.calls.at(-1);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    const outcome = this.queue.shift() ?? this.defaultOutcome;

    switch (outcome) {
      case 'success':
        return { success: true, providerChargeId: `ch_${this.calls.length}` };
      case 'decline':
        return { success: false, failureCode: 'card_declined' };
      case 'timeout':
        throw new PaymentProviderTimeoutError();
    }
  }
}
