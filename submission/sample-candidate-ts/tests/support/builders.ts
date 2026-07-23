import { randomUUID } from "crypto";
import { WebhookEventPayload, WebhookEventType } from "../../src/domain/types";

/**
 * Builder pattern: fluent, readable construction of test payloads.
 * Scenarios read as intent ("a webhook for an amount that doesn't match
 * the invoice") instead of repeating object literals with one field changed.
 */
export class SubscriptionRequestBuilder {
  private customerId = "cust_001";
  private plan: unknown = "basic";
  private paymentMethodId = "pm_test_visa_4242";
  private omitted = new Set<string>();

  withCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withPlan(plan: unknown): this {
    this.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  omitting(...fields: string[]): this {
    fields.forEach((f) => this.omitted.add(f));
    return this;
  }

  build(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      customerId: this.customerId,
      plan: this.plan,
      paymentMethodId: this.paymentMethodId,
    };
    for (const field of this.omitted) delete payload[field];
    return payload;
  }
}

export class WebhookEventBuilder {
  private eventId = `evt_${randomUUID()}`;
  private type: WebhookEventType = "payment.succeeded";
  private subscriptionId = "";
  private invoiceId = "";
  private amountCents = 1900;
  private currency = "USD";

  withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  withType(type: WebhookEventType): this {
    this.type = type;
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  forInvoice(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  withAmount(amountCents: number, currency = "USD"): this {
    this.amountCents = amountCents;
    this.currency = currency;
    return this;
  }

  build(): WebhookEventPayload {
    return {
      eventId: this.eventId,
      type: this.type,
      subscriptionId: this.subscriptionId,
      invoiceId: this.invoiceId,
      amountCents: this.amountCents,
      currency: this.currency,
    };
  }
}
