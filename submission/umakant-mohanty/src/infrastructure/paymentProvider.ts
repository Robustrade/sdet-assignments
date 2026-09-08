import { PaymentOutcome, ProviderChargeRequest } from '../domain/models';

export interface PaymentProvider {
  charge(request: ProviderChargeRequest): Promise<{ outcome: PaymentOutcome; providerReference: string }>;
}

export class MockPaymentProvider implements PaymentProvider {
  private outcome: PaymentOutcome = 'success';
  readonly calls: ProviderChargeRequest[] = [];

  setOutcome(outcome: PaymentOutcome): void { this.outcome = outcome; }
  reset(): void { this.outcome = 'success'; this.calls.length = 0; }
  async charge(request: ProviderChargeRequest): Promise<{ outcome: PaymentOutcome; providerReference: string }> {
    this.calls.push(structuredClone(request));
    if (this.outcome === 'timeout') throw new Error('PAYMENT_PROVIDER_TIMEOUT');
    return { outcome: this.outcome, providerReference: `mock_${request.reference}` };
  }
}
