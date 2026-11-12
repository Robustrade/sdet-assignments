import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../app/api.ts";
import { SubscriptionState, WebhookPayloadBuilder } from "../app/domain.ts";
import { FakePaymentProvider, RecordingPaymentProvider } from "../app/payment.ts";
import { BillingService } from "../app/service.ts";

interface ServerContext {
  service: BillingService;
  provider: RecordingPaymentProvider;
  request: (path: string, options?: RequestInit) => Promise<Response>;
}

async function withServer(
  run: (context: ServerContext) => Promise<void>,
  { provider = new RecordingPaymentProvider() }: { provider?: RecordingPaymentProvider } = {},
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "billing-service-"));
  const service = new BillingService({
    dbPath: join(directory, "billing.db"),
    paymentProvider: provider,
  });
  const server = createApp(service);

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine test server address");
    }
    await run({
      service,
      provider,
      request: (path, options) => fetch(`http://127.0.0.1:${address.port}${path}`, options),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    service.repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function signedWebhook(payload: object, secret = "test-secret") {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return { body, signature };
}

function webhookFor(
  subscriptionId: string,
  eventId: string,
  type: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ...new WebhookPayloadBuilder()
      .withSubscription(subscriptionId)
      .withEventId(eventId)
      .withType(type)
      .build(),
    ...extra,
  };
}

test("API creates, retrieves, and persists a plan-configured subscription", async () => {
  await withServer(async ({ service, request }) => {
    const response = await request("/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      }),
    });

    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.customer_id, "cust_001");
    assert.equal(created.plan, "pro");
    assert.equal(created.state, SubscriptionState.TRIALING);
    assert.equal(created.trial_days, 14);
    assert.equal(created.price_cents, 4900);
    assert.deepEqual(await (await request(`/subscriptions/${created.id}`)).json(), created);
    const subscription = service.repository.getSubscription(created.id);
    assert.ok(subscription);
    assert.equal(subscription.priceCents, 4900);
  });
});

test("invalid plans and missing fields are rejected", async () => {
  await withServer(async ({ request }) => {
    const invalidPlan = await request("/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: "cust_002",
        plan: "enterprise",
        payment_method_id: "pm_123",
      }),
    });
    assert.equal(invalidPlan.status, 400);
    assert.match((await invalidPlan.json()).detail, /Unknown plan/);

    const missingField = await request("/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: "cust_002", plan: "basic" }),
    });
    assert.equal(missingField.status, 400);
  });
});

test("signed webhook updates state and duplicate delivery has no extra side effects", async () => {
  await withServer(async ({ service, request }) => {
    const created = service.createSubscription("cust_003", "pro", "pm_123");
    const payload = webhookFor(created.id, "evt_duplicate_1", "payment.succeeded");
    const { body, signature } = signedWebhook(payload);
    const options = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Provider-Signature": signature,
      },
      body,
    };

    const first = await request("/webhooks/payment-provider", options);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).state, SubscriptionState.ACTIVE);
    const duplicate = await request("/webhooks/payment-provider", options);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { status: "duplicate", event_id: "evt_duplicate_1" });

    assert.equal(service.getSubscription(created.id).state, SubscriptionState.ACTIVE);
    assert.equal(service.repository.getPaymentEvents(created.id).length, 1);
    assert.equal(service.repository.getInvoices(created.id).length, 1);
    const invoice = service.repository.getInvoice("inv_001");
    assert.ok(invoice);
    assert.equal(invoice.status, "paid");
  });
});

test("failed charge transitions trialing to past_due and retry success returns to active", async () => {
  await withServer(async ({ service, request }) => {
    const created = service.createSubscription("cust_004", "basic", "pm_123");

    const events: [string, string, string, Record<string, unknown>?][] = [
      ["evt_failed", "payment.failed", SubscriptionState.PAST_DUE],
      ["evt_retry", "payment.succeeded", SubscriptionState.ACTIVE, { invoice_id: "inv_retry" }],
    ];
    for (const [eventId, type, expectedState, extra = {}] of events) {
      const { body, signature } = signedWebhook(webhookFor(created.id, eventId, type, extra));
      const response = await request("/webhooks/payment-provider", {
        method: "POST",
        headers: { "X-Provider-Signature": signature },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).state, expectedState);
    }

    assert.deepEqual(
      service.repository.getPaymentEvents(created.id).map((event) => event.eventType),
      ["payment.failed", "payment.succeeded"],
    );
    assert.equal(service.repository.getInvoices(created.id).length, 2);
  });
});

test("invalid signatures are rejected and do not persist events", async () => {
  await withServer(async ({ service, request }) => {
    const created = service.createSubscription("cust_005", "pro", "pm_123");
    const { body } = signedWebhook(webhookFor(created.id, "evt_bad_sig", "payment.succeeded"));
    const response = await request("/webhooks/payment-provider", {
      method: "POST",
      headers: { "X-Provider-Signature": "bad-signature" },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal(service.repository.getPaymentEvents(created.id).length, 0);
  });
});

test("canceled subscriptions cannot be reactivated by later payment webhooks", async () => {
  await withServer(async ({ service, request }) => {
    const created = service.createSubscription("cust_006", "basic", "pm_123");
    const canceled = await request(`/subscriptions/${created.id}/cancel`, { method: "POST" });
    assert.equal(canceled.status, 200);
    assert.equal((await canceled.json()).state, SubscriptionState.CANCELED);

    const { body, signature } = signedWebhook(
      webhookFor(created.id, "evt_after_cancel", "payment.succeeded"),
    );
    const response = await request("/webhooks/payment-provider", {
      method: "POST",
      headers: { "X-Provider-Signature": signature },
      body,
    });
    assert.equal(response.status, 409);
    assert.equal(service.getSubscription(created.id).state, SubscriptionState.CANCELED);
    assert.equal(service.repository.getPaymentEvents(created.id).length, 0);
    assert.equal(service.repository.getInvoices(created.id).length, 0);
  });
});

test("payment provider seam records exact call arguments and propagates timeout", async () => {
  await withServer(async ({ service, provider }) => {
    const created = service.createSubscription("cust_007", "basic", "pm_visa");
    const subscription = service.repository.getSubscription(created.id);
    assert.ok(subscription);
    assert.equal(service.chargeCustomer(subscription), true);
    assert.deepEqual(provider.calls[0], {
      customer_id: "cust_007",
      payment_method_id: "pm_visa",
      amount_cents: 1000,
      currency: "USD",
    });
  });

  const timeoutProvider = new FakePaymentProvider({ timeout: true });
  const timedOutService = new BillingService({
    dbPath: ":memory:",
    paymentProvider: timeoutProvider,
  });
  try {
    const created = timedOutService.createSubscription("cust_008", "basic", "pm_123");
    const subscription = timedOutService.repository.getSubscription(created.id);
    assert.ok(subscription);
    assert.throws(
      () => timedOutService.chargeCustomer(subscription),
      /payment provider timeout/,
    );
    assert.equal(timeoutProvider.calls.length, 1);
  } finally {
    timedOutService.repository.close();
  }
});

test("unknown subscription retrieval returns 404", async () => {
  await withServer(async ({ request }) => {
    const response = await request("/subscriptions/not-found");
    assert.equal(response.status, 404);
  });
});
