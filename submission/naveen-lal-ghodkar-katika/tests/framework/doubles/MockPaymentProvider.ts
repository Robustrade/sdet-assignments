import {
  ProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider,
} from '../../../src/providers/PaymentProvider';

type Outcome = { kind: 'succeed' } | { kind: 'decline'; declineCode: string } | { kind: 'timeout' };

/**
 * Configurable test double for the external payment provider.
 *
 * - Default behavior is `succeed`; change it with `willSucceed / willDecline / willTimeout`.
 * - One-shot outcomes (`...Once`) are consumed first, in order, so retry flows read naturally:
 *   `provider.timeoutOnce()` means "first call times out, later calls use the default".
 * - Every call is recorded (via `jest.fn`) for call-count and argument assertions.
 */
export class MockPaymentProvider implements PaymentProvider {
  private defaultOutcome: Outcome = { kind: 'succeed' };
  private readonly queued: Outcome[] = [];
  private chargeSequence = 0;

  readonly charge = jest.fn(
    async (_request: ChargeRequest): Promise<ChargeResult> => this.respond(),
  );

  /** Arguments of every `charge` call, oldest first. */
  get calls(): ChargeRequest[] {
    return this.charge.mock.calls.map(([request]) => ({ ...request }));
  }

  willSucceed(): this {
    this.defaultOutcome = { kind: 'succeed' };
    return this;
  }

  willDecline(declineCode = 'card_declined'): this {
    this.defaultOutcome = { kind: 'decline', declineCode };
    return this;
  }

  willTimeout(): this {
    this.defaultOutcome = { kind: 'timeout' };
    return this;
  }

  succeedOnce(): this {
    this.queued.push({ kind: 'succeed' });
    return this;
  }

  declineOnce(declineCode = 'card_declined'): this {
    this.queued.push({ kind: 'decline', declineCode });
    return this;
  }

  timeoutOnce(): this {
    this.queued.push({ kind: 'timeout' });
    return this;
  }

  private respond(): ChargeResult {
    const outcome = this.queued.shift() ?? this.defaultOutcome;
    switch (outcome.kind) {
      case 'succeed':
        this.chargeSequence += 1;
        return { status: 'succeeded', providerChargeId: `ch_mock_${String(this.chargeSequence).padStart(3, '0')}` };
      case 'decline':
        return { status: 'declined', declineCode: outcome.declineCode };
      case 'timeout':
        throw new ProviderTimeoutError();
    }
  }
}
