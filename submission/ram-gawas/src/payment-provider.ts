export type PaymentResult =
  | { status: 'success'; transactionId: string }
  | { status: 'declined'; reason: string };

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  reference: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<PaymentResult>;
}