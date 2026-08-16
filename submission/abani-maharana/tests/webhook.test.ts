import { describe, expect, it } from "vitest";

import type { Express } from "express";

import { createTestApp, WEBHOOK_SECRET } from "./fixtures/test-app";

import { SubscriptionApiClient } from "./support/api-client";

import { WebhookBuilder } from "./builders/webhook.builder";

describe("Payment provider webhooks", () => {
  async function createSubscription(app: Express) {
    const api = new SubscriptionApiClient(app);

    return api.createSubscription({
      customerId: "cus_webhook",
      paymentMethodId: "pm_webhook",
      plan: "basic",
    });
  }

  it("accepts a valid signed payment.succeeded webhook", async () => {
    const { app, repository } = createTestApp({
      type: "decline",
      reference: "pay_initial_failed",
      failureReason: "card_declined",
    });

    const created = await createSubscription(app);

    expect(created.body.status).toBe("past_due");

    const webhook = new WebhookBuilder()
      .withEventId("evt_success_001")
      .withType("payment.succeeded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_retry_001")
      .withAmount(999)
      .buildSigned(WEBHOOK_SECRET);

    const api = new SubscriptionApiClient(app);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(200);

    expect(response.body.subscription.status).toBe("active");

    expect(repository.hasWebhookEvent("evt_success_001")).toBe(true);

    expect(repository.findPaymentByInvoiceId("inv_retry_001")?.status).toBe(
      "succeeded",
    );
  });

  it("accepts payment.failed and moves ACTIVE to PAST_DUE", async () => {
    const { app } = createTestApp();

    const created = await createSubscription(app);

    expect(created.body.status).toBe("active");

    const webhook = new WebhookBuilder()
      .withEventId("evt_failed_001")
      .withType("payment.failed")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_failed_001")
      .buildSigned(WEBHOOK_SECRET);

    const api = new SubscriptionApiClient(app);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(200);

    expect(response.body.subscription.status).toBe("past_due");
  });

  it("accepts payment.refunded without reactivating or canceling the subscription", async () => {
    const { app, repository } = createTestApp();

    const created = await createSubscription(app);

    const webhook = new WebhookBuilder()
      .withEventId("evt_refund_001")
      .withType("payment.refunded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_refund_001")
      .buildSigned(WEBHOOK_SECRET);

    const api = new SubscriptionApiClient(app);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(200);

    expect(response.body.subscription.status).toBe("active");

    expect(repository.hasWebhookEvent("evt_refund_001")).toBe(true);
  });

  it("processes duplicate event_id exactly once", async () => {
    const { app, repository } = createTestApp({
      type: "decline",
      reference: "pay_initial_failed",
      failureReason: "card_declined",
    });

    const created = await createSubscription(app);

    const webhook = new WebhookBuilder()
      .withEventId("evt_duplicate_001")
      .withType("payment.succeeded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_duplicate_001")
      .buildSigned(WEBHOOK_SECRET);

    const api = new SubscriptionApiClient(app);

    const first = await api.sendWebhook(webhook.payload, webhook.signature);

    const second = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(first.status).toBe(200);

    expect(second.status).toBe(200);

    expect(first.body.duplicate).toBe(false);

    expect(second.body.duplicate).toBe(true);

    expect(
      repository
        .getWebhookEvents()
        .filter((event) => event.eventId === "evt_duplicate_001"),
    ).toHaveLength(1);

    expect(
      repository.getPaymentsBySubscriptionId(created.body.id),
    ).toHaveLength(2);
  });

  it("rejects forged webhook signatures", async () => {
    const { app } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const payload = new WebhookBuilder().withEventId("evt_forged_001").build();

    const response = await api.sendWebhook(payload, "forged-signature");

    expect(response.status).toBe(401);
  });

  it("rejects webhook without signature", async () => {
    const { app } = createTestApp();

    const response = await import("supertest").then(({ default: request }) =>
      request(app).post("/webhooks/payment-provider").send({
        event_id: "evt_no_signature",
        type: "payment.succeeded",
        subscription_id: "sub_001",
        invoice_id: "inv_001",
        amount: 999,
        currency: "USD",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects malformed signed webhook payload", async () => {
    const { app } = createTestApp();

    const api = new SubscriptionApiClient(app);

    /*
     * The malformed event must be created BEFORE signing.
     *
     * Otherwise the signature would belong to the original
     * payload and modifying `type` after signing would correctly
     * result in HTTP 401.
     */
    const webhook = new WebhookBuilder()
      .withEventId("evt_malformed_001")
      .withType("not-a-real-event")
      .buildSigned(WEBHOOK_SECRET);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(400);
  });

  it("ignores stale failed webhook after a successful webhook for the same invoice", async () => {
    const { app, repository } = createTestApp({
      type: "decline",
      reference: "pay_initial_failed",
      failureReason: "card_declined",
    });

    const created = await createSubscription(app);

    const api = new SubscriptionApiClient(app);

    const success = new WebhookBuilder()
      .withEventId("evt_order_success")
      .withType("payment.succeeded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_order_001")
      .buildSigned(WEBHOOK_SECRET);

    const staleFailure = new WebhookBuilder()
      .withEventId("evt_order_failure")
      .withType("payment.failed")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_order_001")
      .buildSigned(WEBHOOK_SECRET);

    await api.sendWebhook(success.payload, success.signature);

    const staleResponse = await api.sendWebhook(
      staleFailure.payload,
      staleFailure.signature,
    );

    expect(staleResponse.status).toBe(200);

    expect(staleResponse.body.subscription.status).toBe("active");

    expect(repository.findPaymentByInvoiceId("inv_order_001")?.status).toBe(
      "succeeded",
    );

    expect(
      repository
        .getAuditEvents(created.body.id)
        .some((event) => event.type === "stale_webhook_ignored"),
    ).toBe(true);
  });

  it("does not reactivate a canceled subscription from payment.succeeded", async () => {
    const { app, repository } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const created = await createSubscription(app);

    await api.cancelSubscription(created.body.id);

    const webhook = new WebhookBuilder()
      .withEventId("evt_canceled_001")
      .withType("payment.succeeded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_canceled_001")
      .buildSigned(WEBHOOK_SECRET);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(409);

    expect(repository.findSubscriptionById(created.body.id)?.status).toBe(
      "canceled",
    );
  });

  it("supports past_due -> active through retry success", async () => {
    const { app, repository } = createTestApp({
      type: "decline",
      reference: "pay_initial_failed",
      failureReason: "card_declined",
    });

    const api = new SubscriptionApiClient(app);

    const created = await createSubscription(app);

    expect(created.body.status).toBe("past_due");

    const webhook = new WebhookBuilder()
      .withEventId("evt_retry_success")
      .withType("payment.succeeded")
      .withSubscriptionId(created.body.id)
      .withInvoiceId("inv_retry_success")
      .buildSigned(WEBHOOK_SECRET);

    const response = await api.sendWebhook(webhook.payload, webhook.signature);

    expect(response.status).toBe(200);

    expect(response.body.subscription.status).toBe("active");

    expect(repository.findPaymentByInvoiceId("inv_retry_success")?.status).toBe(
      "succeeded",
    );
  });
});
