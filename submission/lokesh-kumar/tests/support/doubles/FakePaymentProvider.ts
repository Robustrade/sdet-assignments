import { ProviderTimeoutError } from '../../../src/payment/PaymentProvider.js';
import type { ChargeRequest, ChargeResult, PaymentProvider } from '../../../src/payment/PaymentProvider.js';

export type ProviderBehavior = 'succeed' | 'decline' | 'timeout';

/**
 * Test double for the payment provider. Outcomes are configurable (success, decline,
 * timeout), and every call is recorded so tests can assert on count AND arguments.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private defaultBehavior: ProviderBehavior = 'succeed';
  private queued: ProviderBehavior[] = [];
  private chargeCounter = 0;

  alwaysSucceed(): this {
    this.defaultBehavior = 'succeed';
    return this;
  }
  alwaysDecline(): this {
    this.defaultBehavior = 'decline';
    return this;
  }
  alwaysTimeout(): this {
    this.defaultBehavior = 'timeout';
    return this;
  }
  /** One-off outcomes consumed in order before falling back to the default behavior. */
  enqueue(...behaviors: ProviderBehavior[]): this {
    this.queued.push(...behaviors);
    return this;
  }

  get callCount(): number {
    return this.calls.length;
  }
  get lastCall(): ChargeRequest | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls.length = 0;
    this.queued = [];
    this.defaultBehavior = 'succeed';
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    const behavior = this.queued.shift() ?? this.defaultBehavior;
    this.chargeCounter += 1;
    const chargeId = `ch_fake_${this.chargeCounter}`;
    if (behavior === 'timeout') throw new ProviderTimeoutError();
    if (behavior === 'decline') return { outcome: 'declined', chargeId, declineReason: 'card_declined' };
    return { outcome: 'succeeded', chargeId };
  }
}
