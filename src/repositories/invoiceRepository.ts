
export interface InvoiceRecord {
  id: string;
  subscriptionId: string;
  customerId: string;
  amountCents: number;
  status: 'pending' | 'paid' | 'failed';
  createdAt: Date;
}

export class InvoiceRepository {
  private invoices = new Map<string, InvoiceRecord>();

  save(invoice: InvoiceRecord): InvoiceRecord {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  findById(id: string): InvoiceRecord | undefined {
    return this.invoices.get(id);
  }

  findBySubscriptionId(subscriptionId: string): InvoiceRecord[] {
    return Array.from(this.invoices.values()).filter(
      invoice => invoice.subscriptionId === subscriptionId
    );
  }

  findAll(): InvoiceRecord[] {
    return Array.from(this.invoices.values());
  }

  delete(id: string): boolean {
    return this.invoices.delete(id);
  }
}
