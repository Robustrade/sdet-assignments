export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  outcome: "succeeded" | "declined";
  providerReference: string;
  failureCode?: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class PaymentProviderTimeoutError extends Error {
  constructor(message = "Payment provider request timed out") {
    super(message);
    this.name = "PaymentProviderTimeoutError";
  }
}
