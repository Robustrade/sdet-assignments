export interface ChargeRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
}

export interface ChargeResult {
  success: boolean;
  invoiceId: string;
  error?: string;
}

export interface IPaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}