import {
  ChargeRequest,
  PaymentProvider,
  PaymentResult,
} from '../../src/payment-provider';

export class MockPaymentProvider implements PaymentProvider {
  public calls: ChargeRequest[] = [];

  private result: PaymentResult = {
    status: 'success',
    transactionId: 'txn_default',
  };

  private shouldTimeout = false;

  respondWithSuccess(transactionId = 'txn_001') {
    this.shouldTimeout = false;

    this.result = {
      status: 'success',
      transactionId,
    };
  }

  respondWithDecline(reason = 'card_declined') {
    this.shouldTimeout = false;

    this.result = {
      status: 'declined',
      reason,
    };
  }

  respondWithTimeout() {
    this.shouldTimeout = true;
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.calls.push(request);

    if (this.shouldTimeout) {
      throw new Error('Payment provider timeout');
    }

    return this.result;
  }
}