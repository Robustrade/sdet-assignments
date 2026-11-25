
export interface ChargeRequest {
  subscriptionId: string;
  invoiceId: string;
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export type PaymentResult =
  | {
      status: 'succeeded';
      providerReference: string;
    }
  | {
      status: 'declined';
      reason: string;
    }
  | {
      status: 'timeout';
      reason: string;
    };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<PaymentResult>;
}
