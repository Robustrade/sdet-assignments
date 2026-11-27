import {
  PaymentProvider,
  PaymentResult,
} from '../providers/paymentProvider';

export class PaymentService {
  constructor(private readonly provider: PaymentProvider) {}

  async makePayment(amount: number): Promise<PaymentResult> {
    if (amount <= 0) {
      return {
        status: 'declined',
        message: 'Invalid payment amount',
      };
    }

    return this.provider.processPayment(amount);
  }
}