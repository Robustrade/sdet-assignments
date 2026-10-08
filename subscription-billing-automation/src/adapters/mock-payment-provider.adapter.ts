import { ChargeOutcome, ChargeRequest, PaymentProvider } from './payment-provider.interface';

export class MockPaymentProviderAdapter implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private outcome: ChargeOutcome = { kind: 'succeeded', providerReference: 'ch_test_1' };

  setOutcome(outcome: ChargeOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    this.calls.push({ ...request });
    return { ...this.outcome };
  }
}
