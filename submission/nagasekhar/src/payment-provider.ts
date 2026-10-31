
export type PaymentOutcome = 'success' | 'decline' | 'timeout';

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: 'USD';
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  reference: string;
  error?: 'declined' | 'timeout';
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private outcome: PaymentOutcome = 'success';
  private referenceCounter = 0;

  setOutcome(outcome: PaymentOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });

    if (this.outcome === 'timeout') {
      return {
        success: false,
        reference: '',
        error: 'timeout',
      };
    }

    if (this.outcome === 'decline') {
      return {
        success: false,
        reference: '',
        error: 'declined',
      };
    }

    this.referenceCounter += 1;

    return {
      success: true,
      reference: `pay_test_${this.referenceCounter}`,
    };
  }

  reset(): void {
    this.calls.length = 0;
    this.outcome = 'success';
    this.referenceCounter = 0;
  }
}
