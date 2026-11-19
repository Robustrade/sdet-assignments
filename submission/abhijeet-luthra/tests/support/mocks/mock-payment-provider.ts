import { ChargeRequest, ChargeResult, PaymentProvider, ProviderTimeoutError } from '../../../src/providers/payment-provider';

type ScriptedOutcome = { kind: 'succeed' } | { kind: 'decline'; code: string } | { kind: 'timeout' };

/**
 * Test double for the external payment provider.
 *
 * - Outcomes are scripted in order (`willSucceed`, `willDecline`, `willTimeout`);
 *   when the script is empty the default is success.
 * - Every call is recorded with its exact arguments for assertions.
 * - Provider references are deterministic (`pr_0001`, ...), so tests can send
 *   webhooks that refer to them.
 * - Nothing here touches the network.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  /** Reference issued for each call, in call order (also issued on timeout: the provider may have charged). */
  readonly issuedReferences: string[] = [];
  private readonly script: ScriptedOutcome[] = [];

  willSucceed(times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'succeed' });
    return this;
  }

  willDecline(code = 'card_declined', times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'decline', code });
    return this;
  }

  willTimeout(times = 1): this {
    for (let i = 0; i < times; i++) this.script.push({ kind: 'timeout' });
    return this;
  }

  get callCount(): number {
    return this.calls.length;
  }

  lastCall(): ChargeRequest {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error('MockPaymentProvider was never called');
    return call;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    const reference = `pr_${String(this.calls.length).padStart(4, '0')}`;
    this.issuedReferences.push(reference);
    const next = this.script.shift() ?? { kind: 'succeed' };
    switch (next.kind) {
      case 'succeed':
        return { outcome: 'succeeded', providerReference: reference };
      case 'decline':
        return { outcome: 'declined', providerReference: reference, declineCode: next.code };
      case 'timeout':
        throw new ProviderTimeoutError();
    }
  }
}
