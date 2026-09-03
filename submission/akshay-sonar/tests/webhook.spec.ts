import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { TestFixture } from "./TestFixture";
import { SubscriptionStatus } from "../src/domain/SubscriptionStatus";
import { PaymentStatus } from "../src/domain/Payment";
import { InvoiceStatus } from "../src/domain/Invoice";
import { WebhookBuilder } from "../src/builders/WebhookBuilder";
import { SubscriptionBuilder } from "../src/builders/SubscriptionBuilder";

const WEBHOOK_SECRET = "test-webhook-secret";

function signPayload(payload: object): string {
  const rawBody = JSON.stringify(payload);

  return crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
}

describe("Payment Provider Webhooks", () => {
  it("should process a payment.succeeded webhook, mark invoice as paid, and activate the subscription", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    // Create an open invoice in the repository.
    fixture.server.invoiceRepository.save({
      id: "invoice_001",
      subscriptionId,
      amountInCents: 4900,
      status: InvoiceStatus.OPEN,
      createdAt: new Date(),
    });

    const payload = new WebhookBuilder()
      .withEventId("event_success_001")
      .withType("payment.succeeded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_001")
      .withPaymentId("payment_001")
      .withAmount(4900)
      .build();

    const response = await fixture.api.sendWebhook(
      payload,
      signPayload(payload)
    );

    expect(response.status).toBe(200);

    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.ACTIVE
    );

    const payment =
      fixture.server.paymentRepository.findById(
        "payment_001"
      );

    expect(payment?.status).toBe(
      PaymentStatus.SUCCEEDED
    );

    // Verify invoice state.
    const invoice =
      fixture.server.invoiceRepository.findById(
        "invoice_001"
      );

    expect(invoice?.status).toBe(InvoiceStatus.PAID);
    expect(invoice?.paidAt).toBeDefined();
  });

  it("should reject a webhook with an invalid signature", async () => {
    const fixture = new TestFixture();

    const payload = new WebhookBuilder()
      .withEventId("event_invalid_signature")
      .withType("payment.succeeded")
      .withSubscriptionId("subscription_123")
      .withInvoiceId("invoice_123")
      .withPaymentId("payment_123")
      .withAmount(4900)
      .build();

    const response = await fixture.api.sendWebhook(
      payload,
      "invalid-signature"
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "Invalid webhook signature"
    );
  });

  it("should ignore a duplicate webhook event", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const payload = new WebhookBuilder()
      .withEventId("event_duplicate_001")
      .withType("payment.succeeded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_002")
      .withPaymentId("payment_002")
      .withAmount(4900)
      .build();

    const signature = signPayload(payload);

    const firstResponse =
      await fixture.api.sendWebhook(
        payload,
        signature
      );

    const secondResponse =
      await fixture.api.sendWebhook(
        payload,
        signature
      );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const payments =
      fixture.server.paymentRepository.findAll();

    const matchingPayments = payments.filter(
      (payment) => payment.id === "payment_002"
    );

    expect(matchingPayments).toHaveLength(1);

    const events =
      fixture.server.webhookEventRepository.findAll();

    const matchingEvents = events.filter(
      (event) =>
        event.eventId === "event_duplicate_001"
    );

    expect(matchingEvents).toHaveLength(1);
    expect(matchingEvents[0].processed).toBe(true);
  });

  it("should not regress an active subscription when an older payment.failed webhook arrives", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const successPayload = new WebhookBuilder()
      .withEventId("event_success_002")
      .withType("payment.succeeded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_003")
      .withPaymentId("payment_003")
      .withAmount(4900)
      .build();

    await fixture.api.sendWebhook(
      successPayload,
      signPayload(successPayload)
    );

    const failedPayload = new WebhookBuilder()
      .withEventId("event_failed_old_001")
      .withType("payment.failed")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_003")
      .withPaymentId("payment_003")
      .withAmount(4900)
      .build();

    const response = await fixture.api.sendWebhook(
      failedPayload,
      signPayload(failedPayload)
    );

    expect(response.status).toBe(200);

    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.ACTIVE
    );

    const payment =
      fixture.server.paymentRepository.findById(
        "payment_003"
      );

    expect(payment?.status).toBe(
      PaymentStatus.SUCCEEDED
    );
  });

  it("should process a payment.failed webhook, mark invoice as failed, and move an active subscription to past_due", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const successPayload = new WebhookBuilder()
      .withEventId("event_success_003")
      .withType("payment.succeeded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_004")
      .withPaymentId("payment_004")
      .withAmount(4900)
      .build();

    await fixture.api.sendWebhook(
      successPayload,
      signPayload(successPayload)
    );

    // Create an open invoice for the failed payment.
    fixture.server.invoiceRepository.save({
      id: "invoice_005",
      subscriptionId,
      amountInCents: 4900,
      status: InvoiceStatus.OPEN,
      createdAt: new Date(),
    });

    const failedPayload = new WebhookBuilder()
      .withEventId("event_failed_002")
      .withType("payment.failed")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId("invoice_005")
      .withPaymentId("payment_005")
      .withAmount(4900)
      .build();

    const response = await fixture.api.sendWebhook(
      failedPayload,
      signPayload(failedPayload)
    );

    expect(response.status).toBe(200);

    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    const payment =
      fixture.server.paymentRepository.findById(
        "payment_005"
      );

    expect(payment?.status).toBe(
      PaymentStatus.FAILED
    );

    // Verify invoice state.
    const invoice =
      fixture.server.invoiceRepository.findById(
        "invoice_005"
      );

    expect(invoice?.status).toBe(
      InvoiceStatus.FAILED
    );
  });

  it("should mark a successful payment as refunded", async () => {
    const fixture = new TestFixture();

    // Use SubscriptionBuilder to create deterministic test data.
    const subscription = new SubscriptionBuilder()
      .withId("subscription_refund_001")
      .withCustomerId("customer_123")
      .withPlanId("pro")
      .withStatus(SubscriptionStatus.TRIALING)
      .build();

    fixture.server.subscriptionRepository.save(subscription);

    const payResponse =
      await fixture.api.pay(subscription.id);

    expect(payResponse.status).toBe(200);
    expect(payResponse.body.status).toBe("succeeded");

    const paymentId = payResponse.body.id;

    const refundPayload = new WebhookBuilder()
      .withEventId("event_refund_001")
      .withType("payment.refunded")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(payResponse.body.invoiceId)
      .withPaymentId(paymentId)
      .withAmount(4900)
      .build();

    const response = await fixture.api.sendWebhook(
      refundPayload,
      signPayload(refundPayload)
    );

    expect(response.status).toBe(200);

    // Verify database state.
    const payment =
      fixture.server.paymentRepository.findById(
        paymentId
      );

    expect(payment?.status).toBe(
      PaymentStatus.REFUNDED
    );
  });
});