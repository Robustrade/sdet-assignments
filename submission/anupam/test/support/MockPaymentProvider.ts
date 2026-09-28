import {
  PaymentProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider,
} from '../../src/ports/PaymentProvider';

type ScriptedOutcome =
  | { kind: 'succeed' }
  | { kind: 'decline'; code: string }
  | { kind: 'timeout' };

/**
 * TEST DOUBLE (Mock + Spy) implementing the production PaymentProvider port.
 *  - scripted outcomes: willSucceed / willDecline / willTimeout (FIFO queue)
 *  - records every call (deep copy) so tests assert on arguments, not just "was called"
 *  - strict by default: an UNSCRIPTED charge throws, so a hidden/unexpected charge fails the test
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly script: ScriptedOutcome[] = [];
  private readonly recorded: ChargeRequest[] = [];
  private chargeSeq = 0;

  willSucceed(times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'succeed' });
    return this;
  }
  willDecline(code = 'card_declined', times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'decline', code });
    return this;
  }
  willTimeout(): this {
    this.script.push({ kind: 'timeout' });
    return this;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.recorded.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) {
      throw new Error(
        `MockPaymentProvider: unexpected charge (no scripted outcome) for ${request.invoiceId}`,
      );
    }
    switch (next.kind) {
      case 'succeed':
        return { outcome: 'succeeded', providerChargeId: `ch_mock_${++this.chargeSeq}` };
      case 'decline':
        return { outcome: 'declined', declineCode: next.code };
      case 'timeout':
        throw new PaymentProviderTimeoutError();
    }
  }

  // ---- inspection API ----
  get calls(): readonly ChargeRequest[] {
    return this.recorded.map((c) => structuredClone(c));
  }
  get callCount(): number {
    return this.recorded.length;
  }
  lastCall(): ChargeRequest | undefined {
    return this.calls.at(-1);
  }
  callsFor(subscriptionId: string): ChargeRequest[] {
    return this.calls.filter((c) => c.subscriptionId === subscriptionId);
  }
  /** Unused scripted outcomes usually mean the test set up a charge that never happened. */
  get unusedOutcomes(): number {
    return this.script.length;
  }
}
