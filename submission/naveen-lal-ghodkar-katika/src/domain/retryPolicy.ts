import type { InvoiceRecord } from './Invoice';

/** After this many consecutive failed invoices, a past_due subscription is canceled. */
export const MAX_CHARGE_ATTEMPTS = 3;

/**
 * How many invoices at the end of the subscription's history (ordered by attempt) failed in a row.
 * Any other status ends the run: a paid retry resets the count.
 */
export function consecutiveFailedInvoices(invoicesByAttempt: readonly InvoiceRecord[]): number {
  let count = 0;
  for (let i = invoicesByAttempt.length - 1; i >= 0 && invoicesByAttempt[i].status === 'failed'; i -= 1) {
    count += 1;
  }
  return count;
}

export function retriesExhausted(invoicesByAttempt: readonly InvoiceRecord[]): boolean {
  return consecutiveFailedInvoices(invoicesByAttempt) >= MAX_CHARGE_ATTEMPTS;
}
