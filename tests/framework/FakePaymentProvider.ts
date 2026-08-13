import type {
  ChargeRequest,
  ChargeResult,
  PaymentProviderPort,
} from '../../src/payment/PaymentProviderPort.js';

export type FakeOutcome = 'succeeded' | 'declined' | 'timeout';

let callCounter = 0;

export class FakePaymentProvider implements PaymentProviderPort {
  private outcome: FakeOutcome = 'succeeded';
  private readonly recordedCalls: ChargeRequest[] = [];

  willSucceed(): this {
    this.outcome = 'succeeded';
    return this;
  }

  willDecline(): this {
    this.outcome = 'declined';
    return this;
  }

  willTimeout(): this {
    this.outcome = 'timeout';
    return this;
  }

  reset(): void {
    this.recordedCalls.length = 0;
    this.outcome = 'succeeded';
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.recordedCalls.push({ ...request });
    const status = this.outcome;
    callCounter += 1;
    return {
      status,
      providerRef: `${status}_ref_${callCounter}`,
    };
  }

  get calls(): readonly ChargeRequest[] {
    return [...this.recordedCalls];
  }

  get callCount(): number {
    return this.recordedCalls.length;
  }
}