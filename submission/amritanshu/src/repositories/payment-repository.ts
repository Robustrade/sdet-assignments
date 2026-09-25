import type { Payment } from "../domain/payment.js";

export interface PaymentRepository {
  save(payment: Payment): void;
  findById(id: string): Payment | undefined;
  findByInvoiceId(invoiceId: string): Payment[];
  findBySubscriptionId(subscriptionId: string): Payment[];
}