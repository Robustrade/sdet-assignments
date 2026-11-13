
import {
  PaymentProvider,
  PaymentRequest,
  PaymentResult
} from './PaymentProvider';

export type PaymentScenario =
  | 'success'
  | 'decline'
  | 'timeout';

export class MockPaymentProvider implements PaymentProvider {
  private scenario: PaymentScenario = 'success';
  private callCount = 0;

  private processedPayments = new Map<
  string,
  {
    request: PaymentRequest;
    result: PaymentResult;
  }
>();

  setScenario(scenario: PaymentScenario): void {
    this.scenario = scenario;
  }

  getCallCount(): number {
    return this.callCount;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    if (!request.idempotencyKey?.trim()) {
      throw new Error('Idempotency key is required');
    }

    const existingPayment = this.processedPayments.get(
      request.idempotencyKey
    );
    
    if (existingPayment) {
      const sameRequest =
        existingPayment.request.invoiceId === request.invoiceId &&
        existingPayment.request.amountCents === request.amountCents &&
        existingPayment.request.currency === request.currency;
    
      if (!sameRequest) {
        throw new Error(
          'Idempotency key reused with different payment details'
        );
      }
    
      return { ...existingPayment.result };
    }

    this.callCount++;

    if (this.scenario === 'timeout') {
      throw new Error('Payment provider timeout');
    }

    if (this.scenario === 'decline') {
      const result: PaymentResult = {
        success: false,
        providerPaymentId: '',
        message: 'Payment declined'
      };

      this.processedPayments.set(request.idempotencyKey, {
        request: { ...request },
        result: { ...result }
      });

      return { ...result };
    }

    const result: PaymentResult = {
      success: true,
      providerPaymentId: `pay_${request.invoiceId}`,
      message: 'Payment successful'
    };

    this.processedPayments.set(request.idempotencyKey, {
      request: { ...request },
      result: { ...result }
    });

    return { ...result };
  }
}
