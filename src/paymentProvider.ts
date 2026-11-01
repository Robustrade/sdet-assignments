/**
 * The service talks to the payment company ONLY through this interface.
 * Tests plug in a fake one (tests/helpers/mockPaymentProvider.ts).
 */
export interface ChargeRequest {
  subscriptionId: string;
  invoiceId: string;
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string; // stops the provider charging twice for the same attempt
}

export type ChargeResult = { result: 'succeeded'; chargeId: string } | { result: 'declined'; reason: string };

export class ProviderTimeoutError extends Error {}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
