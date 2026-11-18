
import {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentStatus
} from './payment-provider';

export class MockPaymentProvider implements PaymentProvider {
  private nextStatus: PaymentStatus = 'success';

  public calls: PaymentRequest[] = [];

  setNextStatus(status: PaymentStatus): void {
    this.nextStatus = status;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    this.calls.push(request);

    const status = this.nextStatus;

    // Reset to success after each charge
    this.nextStatus = 'success';

    if (status === 'timeout') {
      throw new Error('Payment provider timeout');
    }

    if (status === 'declined') {
      return {
        status: 'declined',
        message: 'Payment declined'
      };
    }

    return {
      status: 'success',
      transactionId: `txn-${Date.now()}`,
      message: 'Payment successful'
    };
  }
}
