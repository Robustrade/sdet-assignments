
export interface PaymentRecord {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  amountCents: number;
  status: 'success' | 'declined' | 'timeout';
  transactionId?: string;
  createdAt: Date;
}

export class PaymentRepository {
  private payments = new Map<string, PaymentRecord>();

  save(payment: PaymentRecord): PaymentRecord {
    this.payments.set(payment.id, payment);
    return payment;
  }

  findById(id: string): PaymentRecord | undefined {
    return this.payments.get(id);
  }

  findByInvoiceId(invoiceId: string): PaymentRecord[] {
    return Array.from(this.payments.values()).filter(
      payment => payment.invoiceId === invoiceId
    );
  }

  findAll(): PaymentRecord[] {
    return Array.from(this.payments.values());
  }

  delete(id: string): boolean {
    return this.payments.delete(id);
  }
}
