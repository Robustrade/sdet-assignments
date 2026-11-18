
export type PaymentStatus = 'success' | 'declined' | 'timeout';

export interface PaymentRequest {
  customerId: string;
  amount: number;
  currency: string;
}

export interface PaymentResult {
  status: PaymentStatus;
  transactionId?: string;
  message?: string;
}

export interface PaymentProvider {
  charge(request: PaymentRequest): Promise<PaymentResult>;
}
