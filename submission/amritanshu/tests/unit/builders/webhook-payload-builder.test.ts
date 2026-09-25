import { describe, expect, it } from "vitest";

import { WebhookPayloadBuilder } from "../../../src/builders/webhook-payload-builder.js";

describe("WebhookPayloadBuilder", () => {
  it("should build a payment succeeded webhook with defaults", () => {
    const payload = new WebhookPayloadBuilder().build();

    expect(payload).toEqual({
      eventId: "evt_001",
      type: "payment.succeeded",
      subscriptionId: "sub_001",
      invoiceId: "inv_001",
      amountCents: 4900,
      currency: "USD",
    });
  });

  it("should allow webhook properties to be customized", () => {
    const payload = new WebhookPayloadBuilder()
      .withEventId("evt_123")
      .withType("payment.failed")
      .withSubscriptionId("sub_123")
      .withInvoiceId("inv_123")
      .withAmountCents(2900)
      .withCurrency("USD")
      .build();

    expect(payload).toEqual({
      eventId: "evt_123",
      type: "payment.failed",
      subscriptionId: "sub_123",
      invoiceId: "inv_123",
      amountCents: 2900,
      currency: "USD",
    });
  });

  it("should support payment.refunded events", () => {
    const payload = new WebhookPayloadBuilder()
      .withType("payment.refunded")
      .build();

    expect(payload.type).toBe("payment.refunded");
  });
});