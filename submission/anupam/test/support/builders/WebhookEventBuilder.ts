import type { SubscriptionDto } from '../../../src/http/presenters';
import type { WebhookEventType } from '../../../src/domain/types';

let seq = 0;
type Payload = Record<string, unknown>;

/** PATTERN: Builder for provider webhook payloads (valid by default, easy to break on purpose). */
export class WebhookEventBuilder {
  private payload: Payload;

  private constructor(type: WebhookEventType) {
    this.payload = {
      event_id: `evt_test_${String(++seq).padStart(4, '0')}`,
      type,
      subscription_id: 'sub_001',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD',
    };
  }
  static paymentSucceeded() { return new WebhookEventBuilder('payment.succeeded'); }
  static paymentFailed() { return new WebhookEventBuilder('payment.failed'); }
  static paymentRefunded() { return new WebhookEventBuilder('payment.refunded'); }

  /** Targets the subscription's latest invoice with the correct amount/currency. */
  forLatestInvoiceOf(sub: SubscriptionDto): this {
    if (!sub.latest_invoice) throw new Error(`${sub.id} has no invoice yet`);
    this.payload.subscription_id = sub.id;
    this.payload.invoice_id = sub.latest_invoice.id;
    this.payload.amount = sub.latest_invoice.amount;
    this.payload.currency = sub.latest_invoice.currency;
    return this;
  }
  forSubscriptionId(id: string): this { this.payload.subscription_id = id; return this; }
  forInvoiceId(id: string): this { this.payload.invoice_id = id; return this; }
  withEventId(id: string): this { this.payload.event_id = id; return this; }
  withAmount(amount: unknown): this { this.payload.amount = amount; return this; }
  withFailureReason(reason: string): this { this.payload.failure_reason = reason; return this; }
  with(field: string, value: unknown): this { this.payload[field] = value; return this; }
  without(field: string): this { delete this.payload[field]; return this; }
  build(): Payload { return { ...this.payload }; }
}
export const { paymentSucceeded, paymentFailed, paymentRefunded } = {
  paymentSucceeded: () => WebhookEventBuilder.paymentSucceeded(),
  paymentFailed: () => WebhookEventBuilder.paymentFailed(),
  paymentRefunded: () => WebhookEventBuilder.paymentRefunded(),
};
