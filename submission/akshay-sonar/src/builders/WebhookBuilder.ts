import { WebhookEventType } from "../domain/WebhookEvent";

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  payment_id: string;
  amount: number;
}

export class WebhookBuilder {
  private payload: WebhookPayload = {
    event_id: `event_${Date.now()}`,
    type: "payment.succeeded",
    subscription_id: "subscription_1",
    invoice_id: "invoice_1",
    payment_id: "payment_1",
    amount: 4900,
  };

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withType(type: WebhookEventType): this {
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

  withPaymentId(paymentId: string): this {
    this.payload.payment_id = paymentId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  build(): WebhookPayload {
    return {
      ...this.payload,
    };
  }
}