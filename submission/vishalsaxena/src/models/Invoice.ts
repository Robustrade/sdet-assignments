
export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'void'
  | 'uncollectible';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  createdAt?: string;
}

export function createInvoice(
  id: string,
  subscriptionId: string,
  amountCents: number,
  billingPeriodStart: string,
  billingPeriodEnd: string,
  currency = 'USD'
): Invoice {
  if (!id.trim() || !subscriptionId.trim()) {
    throw new Error('Invoice ID and subscription ID are required');
  }

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('Invoice amount must be a non-negative integer');
  }

  if (
    !Number.isFinite(Date.parse(billingPeriodStart)) ||
    !Number.isFinite(Date.parse(billingPeriodEnd)) ||
    Date.parse(billingPeriodStart) >= Date.parse(billingPeriodEnd)
  ) {
    throw new Error('Invalid billing period');
  }

  return {
    id,
    subscriptionId,
    amountCents,
    currency: currency.toUpperCase(),
    status: 'open',
    billingPeriodStart,
    billingPeriodEnd
  };
}
