import { InvoiceStatus } from './types';

export type InvoiceEvent = 'paid' | 'collection_failed' | 'voided' | 'refunded';

const ALLOWED: Readonly<Record<InvoiceStatus, Partial<Record<InvoiceEvent, InvoiceStatus>>>> = {
  open: { paid: 'paid', collection_failed: 'uncollectible', voided: 'void' },
  paid: { refunded: 'refunded' },
  uncollectible: {},
  void: {},
  refunded: {},
};

/**
 * Invoices have their own, smaller state machine. Its main job is to make "paid" sticky:
 * once an invoice is paid, a late failure for it cannot move it anywhere.
 */
export class InvoiceLifecycle {
  static next(from: InvoiceStatus, event: InvoiceEvent): InvoiceStatus | null {
    return ALLOWED[from][event] ?? null;
  }

  static acceptsPaymentOutcome(status: InvoiceStatus): boolean {
    return status === 'open';
  }
}
