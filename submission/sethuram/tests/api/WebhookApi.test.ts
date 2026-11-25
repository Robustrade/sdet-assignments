
import { createAppFixture } from "../fixtures/AppFixture";
import { WebhookSignature } from "../../src/services/WebhookSignature";
import { SubscriptionBuilder } from "../builders/SubscriptionBuilder";
import { WebhookEventBuilder } from "../builders/WebhookEventBuilder";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";

describe("Webhook API integration", () => {
  let client: SubscriptionApiClient;
  let subscriptionId: string;
  let invoiceId: string;
  let amount: number;
  let currency: string;
  let fixture: ReturnType<typeof createAppFixture>;

  const signatureVerifier =
    new WebhookSignature("test_secret");

  beforeEach(async () => {
  fixture = createAppFixture("test_secret");

  client = fixture.client;

    const subscription = await client.createSubscription(
      new SubscriptionBuilder()
        .withCustomerId("cust_001")
        .withPlanId("plan_basic")
        .build()
    );

    expect(subscription.status).toBe(201);

    subscriptionId = subscription.body.id;

    const invoice = await client.billSubscription(
      subscriptionId,
      {
        paymentMethodId: "pm_test_visa_4242",
        idempotencyKey: "billing_001"
      }
    );

    expect(invoice.status).toBe(200);

    invoiceId = invoice.body.id;
    amount = invoice.body.amount;
    currency = invoice.body.currency;
  });

  function createPayload(
    overrides: Record<string, unknown> = {}
  ): string {
    return new WebhookEventBuilder()
      .withEventId("evt_001")
      .withType("payment.refunded")
      .withSubscriptionId(subscriptionId)
      .withInvoiceId(invoiceId)
      .withAmount(amount)
      .withCurrency(currency)
      .toJson(overrides);
  }

  function sendWebhook(
    overrides: Record<string, unknown> = {}
  ) {
    const payload = createPayload(overrides);

    return client.sendWebhook(
      payload,
      signatureVerifier.sign(payload)
    );
  }

  test("accepts a valid signed webhook", async () => {
    const response = await sendWebhook();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("processed");
  });

  test("rejects a missing signature", async () => {
    const response = await client.sendWebhook(
      createPayload()
    );

    expect(response.status).toBe(401);
  });

  test("rejects an invalid signature", async () => {
    const response = await client.sendWebhook(
      createPayload(),
      "invalid"
    );

    expect(response.status).toBe(401);
  });

  test("rejects a tampered webhook payload", async () => {
    const original = createPayload();

    const modified = createPayload({
      amount: 999999
    });

    const response = await client.sendWebhook(
      modified,
      signatureVerifier.sign(original)
    );

    expect(response.status).toBe(401);
  });

  test("handles duplicate webhook events", async () => {
    const first = await sendWebhook();
    const second = await sendWebhook();

    expect(first.status).toBe(200);
    expect(first.body.status).toBe("processed");

    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
  });

  test("handles concurrent duplicate webhooks", async () => {
    const responses = await Promise.all([
      sendWebhook(),
      sendWebhook(),
      sendWebhook(),
      sendWebhook(),
      sendWebhook()
    ]);

    responses.forEach(response => {
      expect(response.status).toBe(200);
    });

    expect(
      responses.filter(
        response => response.body.status === "processed"
      )
    ).toHaveLength(1);

    expect(
      responses.filter(
        response => response.body.status === "duplicate"
      )
    ).toHaveLength(4);
  });

  test("rejects an unsupported event type", async () => {
    const response = await sendWebhook({
      type: "unknown.event"
    });

    expect(response.status).toBe(400);
  });

  test("rejects a missing event ID", async () => {
    const response = await sendWebhook({
      event_id: ""
    });

    expect(response.status).toBe(400);
  });

  test("rejects an unknown invoice", async () => {
    const response = await sendWebhook({
      invoice_id: "unknown_invoice"
    });

    expect(response.status).toBe(404);
  });

  test("rejects a mismatched subscription ID", async () => {
    const response = await sendWebhook({
      subscription_id: "wrong_subscription"
    });

    expect(response.status).toBe(400);
  });

  test("rejects an incorrect payment amount", async () => {
    const response = await sendWebhook({
      amount: 999999
    });

    expect(response.status).toBe(400);
  });

  test("rejects an incorrect currency", async () => {
    const response = await sendWebhook({
      currency: "EUR"
    });

    expect(response.status).toBe(400);
  });

  test("rejects malformed JSON", async () => {
    const payload = "{invalid_json";

    const response = await client.sendWebhook(
      payload,
      signatureVerifier.sign(payload)
    );

    expect(response.status).toBe(400);
  });

  test("refund preserves active subscription status", async () => {
    const webhook = await sendWebhook();

    expect(webhook.status).toBe(200);

    const subscription = await client.getSubscription(
      subscriptionId
    );

    expect(subscription.status).toBe(200);
    expect(subscription.body.status).toBe("active");
  });

  test("invalid event does not prevent a valid retry", async () => {
    const invalid = await sendWebhook({
      amount: 999999
    });

    expect(invalid.status).toBe(400);

    const valid = await sendWebhook();

    expect(valid.status).toBe(200);
    expect(valid.body.status).toBe("processed");
  });
test("persists refunded invoice correctly", async () => {
  const response = await sendWebhook();

  expect(response.status).toBe(200);
  expect(response.body.status).toBe("processed");

  const invoice =
    await fixture.invoiceRepository.findById(invoiceId);

  expect(invoice).toMatchObject({
    id: invoiceId,
    subscriptionId,
    amount,
    currency,
    status: "refunded"
  });
});
test("refund preserves persisted subscription status", async () => {
  const response = await sendWebhook();

  expect(response.status).toBe(200);

  const subscription =
    await fixture.subscriptionRepository.findById(
      subscriptionId
    );

  expect(subscription).toMatchObject({
    id: subscriptionId,
    status: "active"
  });

  expect(fixture.provider.calls).toHaveLength(1);
});
test("persists webhook audit history through API", async () => {
  const response = await sendWebhook();

  expect(response.status).toBe(200);

  const history =
    await fixture.eventRepository.findAuditHistory();

  expect(history).toHaveLength(1);

  expect(history[0]).toMatchObject({
    eventId: "evt_001",
    outcome: "processed"
  });

  expect(
    await fixture.eventRepository.count()
  ).toBe(1);
});
test("duplicate webhook does not modify persisted invoice", async () => {
  const first = await sendWebhook();

  expect(first.body.status).toBe("processed");

  const originalInvoice =
    await fixture.invoiceRepository.findById(invoiceId);

  const second = await sendWebhook();

  expect(second.body.status).toBe("duplicate");

  expect(
    await fixture.invoiceRepository.findById(invoiceId)
  ).toEqual(originalInvoice);

  expect(fixture.provider.calls).toHaveLength(1);

  expect(
    await fixture.eventRepository.count()
  ).toBe(1);

  const history =
    await fixture.eventRepository.findAuditHistory();

  expect(history.map(record => record.outcome)).toEqual([
    "processed",
    "duplicate"
  ]);
});
test("concurrent webhooks maintain persistence integrity", async () => {
  const responses = await Promise.all([
    sendWebhook(),
    sendWebhook(),
    sendWebhook(),
    sendWebhook(),
    sendWebhook()
  ]);

  expect(
    responses.every(response => response.status === 200)
  ).toBe(true);

  expect(
    responses.filter(
      response => response.body.status === "processed"
    )
  ).toHaveLength(1);

  expect(
    responses.filter(
      response => response.body.status === "duplicate"
    )
  ).toHaveLength(4);

  expect(
    await fixture.eventRepository.count()
  ).toBe(1);

  const history =
    await fixture.eventRepository.findAuditHistory();

  expect(history).toHaveLength(5);

  const invoice =
    await fixture.invoiceRepository.findById(invoiceId);

  expect(invoice?.status).toBe("refunded");

  expect(fixture.provider.calls).toHaveLength(1);
});
});
