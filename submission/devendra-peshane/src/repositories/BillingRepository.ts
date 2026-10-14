export type InvoiceStatus = "pending" | "paid" | "failed" | "refunded";

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  status: InvoiceStatus;
  transactionId?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  status: "succeeded" | "failed" | "refunded";
  transactionId?: string;
}

export interface WebhookEvent {
  id: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
  invoiceId: string;
  processed: boolean;
}

export interface AuditRecord {
  action: string;
  entityId: string;
  timestamp: string;
}

export class BillingRepository {
  private readonly invoices = new Map<string, Invoice>();
  private readonly payments = new Map<string, Payment>();
  private readonly events = new Map<string, WebhookEvent>();
  private readonly auditRecords: AuditRecord[] = [];

  saveInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  findInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : undefined;
  }

  savePayment(payment: Payment): void {
    this.payments.set(payment.id, { ...payment });
  }

  findPayment(id: string): Payment | undefined {
    const payment = this.payments.get(id);
    return payment ? { ...payment } : undefined;
  }

  saveEvent(event: WebhookEvent): void {
    this.events.set(event.id, { ...event });
  }

  findEvent(id: string): WebhookEvent | undefined {
    const event = this.events.get(id);
    return event ? { ...event } : undefined;
  }

  addAudit(record: AuditRecord): void {
    this.auditRecords.push({ ...record });
  }

  getAuditRecords(): AuditRecord[] {
    return this.auditRecords.map((record) => ({ ...record }));
  }
}
