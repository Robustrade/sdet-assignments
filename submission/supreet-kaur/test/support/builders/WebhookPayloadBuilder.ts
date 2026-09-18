import { randomUUID } from "node:crypto";

export interface WebhookPayload {
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

/**
 * Builder pattern for inbound webhook payloads. Centralizing this is what makes idempotency
 * tests readable: `.succeeded().withEventId("evt_fixed").build()` sent twice, versus manually
 * writing out two near-identical JSON literals and hoping event_id matches both times.
 */
export class WebhookPayloadBuilder {
  private eventId = `evt_${randomUUID()}`;
  private type = "payment.succeeded";
  private subscriptionId = "";
  private invoiceId = "";
  private amount = 4900;
  private currency = "USD";

  static forInvoice(subscriptionId: string, invoiceId: string, amount: number, currency = "USD"): WebhookPayloadBuilder {
    return new WebhookPayloadBuilder().withSubscription(subscriptionId).withInvoice(invoiceId).withAmount(amount).withCurrency(currency);
  }

  withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  withSubscription(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  withInvoice(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  succeeded(): this {
    this.type = "payment.succeeded";
    return this;
  }

  failed(): this {
    this.type = "payment.failed";
    return this;
  }

  refunded(): this {
    this.type = "payment.refunded";
    return this;
  }

  ofType(type: string): this {
    this.type = type;
    return this;
  }

  build(): WebhookPayload {
    return {
      event_id: this.eventId,
      type: this.type,
      subscription_id: this.subscriptionId,
      invoice_id: this.invoiceId,
      amount: this.amount,
      currency: this.currency,
    };
  }
}
