    import type { WebhookEvent } from "../domain/webhook-event.js";

export class WebhookPayloadBuilder {
  private payload: WebhookEvent = {
    eventId: "evt_001",
    type: "payment.succeeded",
    subscriptionId: "sub_001",
    invoiceId: "inv_001",
    amountCents: 4900,
    currency: "USD",
  };

  withEventId(eventId: string): this {
    this.payload.eventId = eventId;
    return this;
  }

  withType(type: WebhookEvent["type"]): this {
    this.payload.type = type;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.payload.subscriptionId = subscriptionId;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.payload.invoiceId = invoiceId;
    return this;
  }

  withAmountCents(amountCents: number): this {
    this.payload.amountCents = amountCents;
    return this;
  }

  withCurrency(currency: string): this {
    this.payload.currency = currency;
    return this;
  }

  build(): WebhookEvent {
    return {
      ...this.payload,
    };
  }
}