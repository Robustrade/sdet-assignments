import {
  PaymentProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider
} from '../../../src/payments/payment-provider';

export type ScriptedOutcome =
  | { kind: 'succeed'; chargeId?: string }
  | { kind: 'decline'; declineCode?: string }
  | { kind: 'timeout' };

/**
 * Test double for the external payment provider.
 *
 * It is a hand-written fake rather than a bare `vi.fn()` because the tests need
 * three things a stub mock makes awkward: a per-attempt outcome script, a full
 * record of call arguments for interaction assertions, and the ability to model
 * a timeout as a thrown error rather than a return value.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private readonly script: ScriptedOutcome[] = [];
  private fallback: ScriptedOutcome = { kind: 'succeed' };
  private chargeSeq = 0;

  /** Default outcome once the script is exhausted. */
  alwaysSucceeds(): this {
    this.fallback = { kind: 'succeed' };
    return this;
  }

  alwaysDeclines(declineCode = 'card_declined'): this {
    this.fallback = { kind: 'decline', declineCode };
    return this;
  }

  alwaysTimesOut(): this {
    this.fallback = { kind: 'timeout' };
    return this;
  }

  /** Queue outcomes consumed in order, one per billing attempt. */
  willRespond(...outcomes: ScriptedOutcome[]): this {
    this.script.push(...outcomes);
    return this;
  }

  succeedsOnce(): this {
    return this.willRespond({ kind: 'succeed' });
  }

  declinesOnce(declineCode = 'card_declined'): this {
    return this.willRespond({ kind: 'decline', declineCode });
  }

  timesOutOnce(): this {
    return this.willRespond({ kind: 'timeout' });
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastCall(): ChargeRequest | undefined {
    return this.calls[this.calls.length - 1];
  }

  callsForSubscription(subscriptionId: string): ChargeRequest[] {
    return this.calls.filter((c) => c.reference.subscriptionId === subscriptionId);
  }

  idempotencyKeys(): string[] {
    return this.calls.map((c) => c.idempotencyKey);
  }

  /** A point in the call log a test can measure from. */
  mark(): number {
    return this.calls.length;
  }

  callsSince(mark: number): ChargeRequest[] {
    return this.calls.slice(mark);
  }

  reset(): void {
    this.calls.length = 0;
    this.script.length = 0;
    this.chargeSeq = 0;
    this.fallback = { kind: 'succeed' };
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(structuredClone(request));
    const outcome = this.script.shift() ?? this.fallback;
    switch (outcome.kind) {
      case 'succeed':
        return { outcome: 'succeeded', chargeId: outcome.chargeId ?? `ch_${++this.chargeSeq}` };
      case 'decline':
        return { outcome: 'declined', declineCode: outcome.declineCode ?? 'card_declined' };
      case 'timeout':
        throw new PaymentProviderTimeoutError();
    }
  }
}
