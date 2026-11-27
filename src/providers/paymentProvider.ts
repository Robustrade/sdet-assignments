export type PaymentResult =
  | {
      status: 'success';
      transactionId: string;
    }
  | {
      status: 'declined';
      message: string;
    }
  | {
      status: 'timeout';
      message: string;
    };

export interface PaymentProvider {
  processPayment(amount: number): Promise<PaymentResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  private nextResult: 'success' | 'declined' | 'timeout' = 'success';

  setNextResult(result: 'success' | 'declined' | 'timeout'): void {
    this.nextResult = result;
  }

  async processPayment(amount: number): Promise<PaymentResult> {
    if (amount <= 0) {
      return {
        status: 'declined',
        message: 'Invalid payment amount',
      };
    }

    const result = this.nextResult;
    this.nextResult = 'success';

    if (result === 'declined') {
      return {
        status: 'declined',
        message: 'Payment was declined',
      };
    }

    if (result === 'timeout') {
      return {
        status: 'timeout',
        message: 'Payment provider timed out',
      };
    }

    return {
      status: 'success',
      transactionId: `txn_${Date.now()}`,
    };
  }
}