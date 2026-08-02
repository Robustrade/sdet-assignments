import { PaymentProvider, ChargeRequest } from './PaymentProvider';

export class MockPaymentProvider implements PaymentProvider {
  public calls: ChargeRequest[] = [];
  public nextOutcome: 'success' | 'decline' | 'timeout' = 'success';

  async charge(request: ChargeRequest): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    this.calls.push(request);

    if (this.nextOutcome === 'timeout') {
      throw new Error('Payment provider timeout');
    }

    if (this.nextOutcome === 'decline') {
      return { success: false, error: 'card_declined' };
    }

    return { success: true, transactionId: `txn_${Date.now()}` };
  }

  reset() {
    this.calls = [];
    this.nextOutcome = 'success';
  }
}
