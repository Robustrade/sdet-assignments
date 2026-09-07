import {
  PaymentProviderClient, ChargeRequest, ChargeResult, ChargeOutcome,
} from '../domain/paymentProvider';


export class MockPaymentProvider implements PaymentProviderClient {
  public readonly calls: ChargeRequest[] = [];

  private queuedOutcome: ChargeOutcome = 'succeeded';

  setOutcome(outcome: ChargeOutcome): void {
    this.queuedOutcome = outcome;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);
    if (this.queuedOutcome === 'timeout') {
      throw new Error('provider_timeout');
    }
    return {
      outcome: this.queuedOutcome,
      providerChargeId: this.queuedOutcome === 'succeeded' ? `ch_${this.calls.length}` : null,
    };
  }

  callCount(): number {
    return this.calls.length;
  }

  lastCall(): ChargeRequest | undefined {
    return this.calls[this.calls.length - 1];
  }
}
