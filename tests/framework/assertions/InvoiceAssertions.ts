import { expect } from 'vitest';
import type { Invoice } from '../../../src/domain/types.js';

export class InvoiceAssertions {
  static expectExactlyOneInvoiceFor(subscriptionId: string, invoices: readonly Invoice[]): void {
    const rows = invoices.filter((i) => i.subscriptionId === subscriptionId);
    expect(rows.length, `expected exactly one invoice for ${subscriptionId}, got ${rows.length}`).toBe(1);
  }

  static expectNoDuplicateInvoiceFor(subscriptionId: string, invoiceId: string, invoices: readonly Invoice[]): void {
    const matches = invoices.filter(
      (i) => i.subscriptionId === subscriptionId && i.invoiceId === invoiceId,
    );
    expect(matches.length, `expected no duplicate invoice ${invoiceId}, got ${matches.length}`).toBe(1);
  }

  static expectInvoiceStatus(invoices: readonly Invoice[], subscriptionId: string, status: 'succeeded' | 'failed'): void {
    const rows = invoices.filter((i) => i.subscriptionId === subscriptionId);
    expect(rows.length, `expected invoices for ${subscriptionId}`).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe(status);
  }

  static expectHasSucceededInvoiceFor(invoiceId: string, invoices: readonly Invoice[]): void {
    const matches = invoices.filter((i) => i.invoiceId === invoiceId && i.status === 'succeeded');
    expect(matches.length, `expected a succeeded invoice for ${invoiceId}`).toBeGreaterThan(0);
  }
}