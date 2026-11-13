
export type PaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded';

export interface Payment {
  id: string;
  invoiceId: string;
  providerPaymentId?: string;
  amountCents: number;
  status: PaymentStatus;
  createdAt?: string;
  updatedAt?: string;
}

export function createPayment(
  id: string,
  invoiceId: string,
  amountCents: number
): Payment {
  if (!id.trim() || !invoiceId.trim()) {
    throw new Error('Payment ID and invoice ID are required');
  }

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('Payment amount must be a non-negative integer');
  }

  return {
    id,
    invoiceId,
    amountCents,
    status: 'pending'
  };
}
