import {
  ProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider,
} from '../../../src/provider/PaymentProvider';

type ScriptedOutcome =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'held'; readonly released: Promise<void> }
  | { readonly kind: 'decline'; readonly code: string }
  | { readonly kind: 'timeout' };

/**
 * Test double for the external payment provider.
 *
 * Every outcome must be scripted up front. An unscripted charge throws, so an
 * unexpected billing attempt fails the test loudly instead of silently "succeeding".
 * Conversely, TestEnvironment fails any test that leaves a scripted outcome unused,
 * which catches an expected charge that never happened.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly recorded: ChargeRequest[] = [];
  private readonly script: ScriptedOutcome[] = [];
  private refSeq = 0;

  willSucceed(): this {
    this.script.push({ kind: 'succeed' });
    return this;
  }

  willDecline(code = 'card_declined'): this {
    this.script.push({ kind: 'decline', code });
    return this;
  }

  /**
   * The next charge blocks inside the provider until the returned function is called,
   * then succeeds. Lets a test act while a charge is provably in flight, instead of
   * hoping two concurrent requests happen to overlap.
   */
  willSucceedWhenReleased(): () => void {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    this.script.push({ kind: 'held', released });
    return release;
  }

  willTimeout(): this {
    this.script.push({ kind: 'timeout' });
    return this;
  }

  get calls(): readonly ChargeRequest[] {
    return this.recorded;
  }

  lastCall(): ChargeRequest {
    const last = this.recorded.at(-1);
    if (!last) throw new Error('MockPaymentProvider: no charge has been made');
    return last;
  }

  unconsumedOutcomes(): readonly string[] {
    return this.script.map((s) => s.kind);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.recorded.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) {
      throw new Error(`MockPaymentProvider: unexpected charge, no outcome scripted: ${JSON.stringify(request)}`);
    }
    const providerRef = `ch_mock_${++this.refSeq}`;
    switch (next.kind) {
      case 'succeed':
        return { status: 'succeeded', providerRef };
      case 'held':
        await next.released;
        return { status: 'succeeded', providerRef };
      case 'decline':
        return { status: 'declined', providerRef, declineCode: next.code };
      case 'timeout':
        throw new ProviderTimeoutError(`provider did not answer for ${request.idempotencyKey}`);
    }
  }
}
