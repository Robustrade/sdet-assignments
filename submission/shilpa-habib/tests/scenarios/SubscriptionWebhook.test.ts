
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/api/app";
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { InMemoryBillingRepository } from "../../src/persistence/InMemoryBillingRepository";
import { FakePaymentProvider } from "../../src/payments/FakePaymentProvider";

const WEBHOOK_SECRET = "test_webhook_secret";

function signPayload(rawBody: string): string {
  return createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
}

describe("Payment webhook API", () => {
  let repository: InMemoryBillingRepository;
  let provider: FakePaymentProvider;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    provider = new FakePaymentProvider();

    repository.saveCustomer({
      id: "cust_001",
      email: "customer@example.com",
      paymentMethodId: "pm_test_visa_4242",
    });

    app = createApp(
      new SubscriptionService(repository, provider),
      repository,
    );
  });

it("ignores a stale failure event after an invoice has succeeded", async () => {
  const created = await request(app)
    .post("/subscriptions")
    .send({
      customer_id: "cust_001",
      plan: "pro",
      payment_method_id: "pm_test_visa_4242",
    });

  const subscriptionId = created.body.id as string;
  const invoiceId = "inv_stale_failure_001";
  const now = new Date().toISOString();

  repository.saveInvoice({
    id: invoiceId,
    subscriptionId,
    customerId: "cust_001",
    amountInCents: 4900,
    currency: "USD",
    status: "succeeded",
    providerReference: "pay_existing_001",
    idempotencyKey: `${subscriptionId}-stale-test`,
    createdAt: now,
    updatedAt: now,
  });

  const rawBody = JSON.stringify({
    event_id: "evt_stale_failure_001",
    type: "payment.failed",
    subscription_id: subscriptionId,
    invoice_id: invoiceId,
    amount: 4900,
    currency: "USD",
  });

  const response = await request(app)
    .post("/webhooks/payment-provider")
    .set("Content-Type", "application/json")
    .set("X-Provider-Signature", signPayload(rawBody))
    .send(rawBody);

  expect(response.status).toBe(200);
  expect(repository.getInvoice(invoiceId)?.status).toBe("succeeded");
  expect(repository.getInvoice(invoiceId)?.providerReference).toBe(
    "pay_existing_001",
  );
  expect(repository.getSubscription(subscriptionId)?.status).toBe("trialing");
  expect(
    repository.getWebhookEvent("evt_stale_failure_001")?.ignoredReason,
  ).toContain("already succeeded");
});

  it("processes a signed success event once despite duplicate delivery", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

    expect(created.status).toBe(201);

    const subscriptionId = created.body.id as string;
    const invoiceId = "inv_webhook_001";
    const now = new Date().toISOString();

    repository.saveInvoice({
      id: invoiceId,
      subscriptionId,
      customerId: "cust_001",
      amountInCents: 4900,
      currency: "USD",
      status: "pending",
      providerReference: null,
      idempotencyKey: `${subscriptionId}-webhook-charge`,
      createdAt: now,
      updatedAt: now,
    });

    const payload = {
      event_id: "evt_success_001",
      type: "payment.succeeded",
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount: 4900,
      currency: "USD",
    };

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const firstResponse = await request(app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", signature)
      .send(rawBody);

    expect(firstResponse.status).toBe(200);
    expect(repository.getSubscription(subscriptionId)?.status).toBe("active");
    expect(repository.getInvoice(invoiceId)?.status).toBe("succeeded");

    const secondResponse = await request(app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", signature)
      .send(rawBody);

    expect(secondResponse.status).toBe(200);
    expect(repository.getSubscription(subscriptionId)?.status).toBe("active");
    expect(repository.getInvoicesForSubscription(subscriptionId)).toHaveLength(1);
    expect(repository.getAllWebhookEvents()).toHaveLength(1);
    expect(repository.getWebhookEvent("evt_success_001")?.duplicate).toBe(true);
    expect(provider.getCallCount()).toBe(0);
  });

  it("rejects an invalid signature without changing persisted state", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

    const subscriptionId = created.body.id as string;
    const original = repository.getSubscription(subscriptionId);

    const rawBody = JSON.stringify({
      event_id: "evt_invalid_signature",
      type: "payment.succeeded",
      subscription_id: subscriptionId,
      invoice_id: "inv_missing",
      amount: 4900,
      currency: "USD",
    });

    const response = await request(app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", "invalid-signature")
      .send(rawBody);

    expect(response.status).toBe(401);
    expect(repository.getSubscription(subscriptionId)).toEqual(original);
    expect(repository.getAllWebhookEvents()).toHaveLength(0);
  });

  it("rejects a malformed payload without persisting a webhook event", async () => {
    const rawBody = '{"event_id":';

    const response = await request(app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", signPayload(rawBody))
      .send(rawBody);

    expect(response.status).toBe(400);
    expect(repository.getAllWebhookEvents()).toHaveLength(0);
    expect(repository.getAllSubscriptions()).toHaveLength(0);
  });

});
