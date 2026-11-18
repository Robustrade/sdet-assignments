export type PaymentWebhookType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export interface PaymentWebhookPayload {
  event_id: string;
  type: PaymentWebhookType;
  subscription_id: string;
  invoice_id: string;
}

export class WebhookEventBuilder {
  private payload: PaymentWebhookPayload = {
    event_id: 'evt-test-001',
    type: 'payment.succeeded',
    subscription_id: 'sub-test-001',
    invoice_id: 'inv-test-001'
  };

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withType(type: PaymentWebhookType): this {
    this.payload.type = type;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  build(): PaymentWebhookPayload {
    return { ...this.payload };
  }
}
