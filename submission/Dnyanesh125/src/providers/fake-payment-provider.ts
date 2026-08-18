import {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentOutcome,
} from './payment-provider';

export interface PaymentCall {
  request: PaymentRequest;
}

export class FakePaymentProvider implements PaymentProvider {
  private outcome: PaymentOutcome = 'success';
  private calls: PaymentCall[] = [];

  setOutcome(outcome: PaymentOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    this.calls.push({ request });

    if (this.outcome === 'timeout') {
      throw new Error('Payment provider timeout');
    }

    if (this.outcome === 'declined') {
      return {
        outcome: 'declined',
        message: 'Payment declined',
      };
    }

    return {
      outcome: 'success',
      providerPaymentId: `pay_${Date.now()}`,
    };
  }

  getCalls(): PaymentCall[] {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  reset(): void {
    this.calls = [];
    this.outcome = 'success';
  }
}
