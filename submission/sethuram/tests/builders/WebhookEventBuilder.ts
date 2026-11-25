import {
  WebhookEvent,
  WebhookEventType
} from "../../src/domain/WebhookEvent";

export interface WebhookPayload extends WebhookEvent {
  event_id: string;
}

export class WebhookEventBuilder {
  private event: WebhookPayload = {
    event_id: "evt_001",
    type: "payment.refunded",
    subscription_id: "sub_001",
    invoice_id: "inv_001",
    amount: 4900,
    currency: "USD"
  };

  withEventId(eventId: string): this {
    this.event.event_id = eventId;
    return this;
  }

  withType(type: WebhookEventType): this {
    this.event.type = type;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.event.subscription_id = subscriptionId;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.event.invoice_id = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.event.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.event.currency = currency;
    return this;
  }

  build(): WebhookPayload {
    return { ...this.event };
  }

  toJson(
    overrides: Record<string, unknown> = {}
  ): string {
    return JSON.stringify({
      ...this.build(),
      ...overrides
    });
  }
}