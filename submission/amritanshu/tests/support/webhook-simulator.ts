import type { SubscriptionApiClient } from "./api-client.js";
import { generateSignature } from "../../src/api/signature.js";
import { WebhookPayloadBuilder } from "../../src/builders/webhook-payload-builder.js";

export class WebhookSimulator {
  constructor(
    private readonly apiClient: SubscriptionApiClient,
    private readonly secret: string,
  ) {}

  async sendPaymentSucceeded(
    subscriptionId: string,
    invoiceId: string,
    amountCents: number,
    eventId = "evt_success_001",
  ) {
    const payload = new WebhookPayloadBuilder()
      .withEventId(eventId)
      .withType("payment.succeeded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId(invoiceId)
      .withAmountCents(amountCents)
      .withCurrency("USD")
      .build();

    const rawBody = JSON.stringify({
      event_id: payload.eventId,
      type: payload.type,
      subscription_id: payload.subscriptionId,
      invoice_id: payload.invoiceId,
      amount: payload.amountCents,
      currency: payload.currency,
    });

    const signature = generateSignature(
      rawBody,
      this.secret,
    );

    return this.apiClient.sendWebhook(
      JSON.parse(rawBody),
      signature,
    );
  }

  async sendPaymentFailed(
    subscriptionId: string,
    invoiceId: string,
    amountCents: number,
    eventId = "evt_failed_001",
  ) {
    const payload = new WebhookPayloadBuilder()
      .withEventId(eventId)
      .withType("payment.failed")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId(invoiceId)
      .withAmountCents(amountCents)
      .withCurrency("USD")
      .build();

    const rawBody = JSON.stringify({
      event_id: payload.eventId,
      type: payload.type,
      subscription_id: payload.subscriptionId,
      invoice_id: payload.invoiceId,
      amount: payload.amountCents,
      currency: payload.currency,
    });

    const signature = generateSignature(
      rawBody,
      this.secret,
    );

    return this.apiClient.sendWebhook(
      JSON.parse(rawBody),
      signature,
    );
  }

  async sendPaymentRefunded(
    subscriptionId: string,
    invoiceId: string,
    amountCents: number,
    eventId = "evt_refund_001",
  ) {
    const payload = new WebhookPayloadBuilder()
      .withEventId(eventId)
      .withType("payment.refunded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId(invoiceId)
      .withAmountCents(amountCents)
      .withCurrency("USD")
      .build();

    const rawBody = JSON.stringify({
      event_id: payload.eventId,
      type: payload.type,
      subscription_id: payload.subscriptionId,
      invoice_id: payload.invoiceId,
      amount: payload.amountCents,
      currency: payload.currency,
    });

    const signature = generateSignature(
      rawBody,
      this.secret,
    );

    return this.apiClient.sendWebhook(
      JSON.parse(rawBody),
      signature,
    );
  }
}