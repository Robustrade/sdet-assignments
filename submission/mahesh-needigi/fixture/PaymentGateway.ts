export interface ChargeRequest {
  readonly customerId: string;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethodId: string;
}

export interface ChargeResult {
  readonly status: string;
  readonly transactionId?: string;
  readonly declineReason?: string;
}

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
