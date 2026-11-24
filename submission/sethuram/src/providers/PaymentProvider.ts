
export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  transactionId: string;
  status: "succeeded" | "declined";
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
