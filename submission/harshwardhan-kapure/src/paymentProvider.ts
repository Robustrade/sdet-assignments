import { ChargeOutcome } from './types';

/**
 * PaymentProvider defines the seam between billing logic and any external payment gateway.
 */
export interface PaymentProvider {
  charge(
    customerId: string,
    amount: number,
    paymentMethodId: string,
    idempotencyRef: string
  ): Promise<ChargeOutcome>;
}
