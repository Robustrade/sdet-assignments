import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Invoice,
  SubscriptionData,
} from "../src/domain.js";
import type { ChargeResult } from "../src/payment-provider.js";
import {
  fixtureForTest,
  subscriptionPayload,
  webhookPayload,
} from "./fixture.js";

const webhookAmount = 9900;

function isSubscriptionData(value: unknown): value is SubscriptionData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.customerId === "string" &&
    typeof record.planId === "string" &&
    typeof record.status === "string" &&
    typeof record.createdAt === "string"
  );
}

function responseSubscription(body: Record<string, unknown>): SubscriptionData {
  const value = body.subscription;
  assert.ok(isSubscriptionData(value), "response should contain a subscription");
  return value;
}

async function createSubscription(
  api: Awaited<ReturnType<typeof fixtureForTest>>["api"],
  planId = "pro",
): Promise<SubscriptionData> {
  const response = await api.createSubscription(subscriptionPayload({ planId }));
  assert.equal(response.status, 201);
  return responseSubscription(response.body);
}

function invoiceFor(
  invoices: Invoice[],
  invoiceId: string,
): Invoice {
  const invoice = invoices.find((item) => item.id === invoiceId);
  assert.ok(invoice, `invoice ${invoiceId} should exist`);
  return invoice;
}

test("immediate billing persists payment and agrees with the API", async (context) => {
  const fixture = await fixtureForTest(context);
  const response = await fixture.api.createSubscription(
    subscriptionPayload({ planId: "basic" }),
  );

  assert.equal(response.status, 201);
  const subscription = responseSubscription(response.body);
  assert.equal(subscription.status, "active");
  assert.equal(fixture.provider.calls.length, 1);
  assert.deepEqual(fixture.provider.calls[0], {
    customerId: "cust_001",
    paymentMethodId: "pm_test_visa_4242",
    amount: 4900,
    currency: "USD",
    reference: fixture.repository.getInvoicesForSubscription(subscription.id)[0]?.id,
  });

  const invoice = fixture.repository.getInvoicesForSubscription(subscription.id)[0];
  assert.ok(invoice);
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.amount, 4900);
  assert.deepEqual(fixture.repository.getSubscription(subscription.id), subscription);
  const fetched = await fixture.api.getSubscription(subscription.id);
  assert.equal(fetched.status, 200);
  assert.equal(responseSubscription(fetched.body).status, "active");
  assert.ok(
    fixture.repository
      .getAuditRecords(subscription.id)
      .some((record) => record.fromStatus === "trialing" && record.toStatus === "active"),
  );
});

test("trial plan does not charge before its configured trial ends", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  assert.equal(subscription.status, "trialing");
  assert.equal(subscription.trialEndsAt, "2026-01-15T00:00:00.000Z");
  assert.equal(fixture.provider.calls.length, 0);
  assert.deepEqual(fixture.repository.getInvoicesForSubscription(subscription.id), []);
});

test("plan change updates future billing configuration without charging or resetting lifecycle", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  const response = await fixture.api.changePlan(subscription.id, "basic");

  assert.equal(response.status, 200);
  const changed = responseSubscription(response.body);
  assert.equal(changed.planId, "basic");
  assert.equal(changed.status, "trialing");
  assert.equal(changed.trialEndsAt, subscription.trialEndsAt);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.planId, "basic");
  assert.equal(fixture.provider.calls.length, 0);
  assert.equal(fixture.repository.getInvoicesForSubscription(subscription.id).length, 0);
  assert.ok(
    fixture.repository
      .getAuditRecords(subscription.id)
      .some(
        (record) =>
          record.action === "subscription.plan_changed" &&
          record.referenceId === "pro->basic",
      ),
  );
});

test("invalid plan changes do not mutate a subscription or call the provider", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  const unknownPlan = await fixture.api.changePlan(subscription.id, "enterprise");
  assert.equal(unknownPlan.status, 422);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.planId, "pro");

  const canceled = await fixture.api.cancelSubscription(subscription.id);
  assert.equal(canceled.status, 200);
  const canceledPlanChange = await fixture.api.changePlan(subscription.id, "basic");
  assert.equal(canceledPlanChange.status, 409);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.planId, "pro");
  assert.equal(fixture.provider.calls.length, 0);
});

test("invalid creation requests do not persist data or call the provider", async (context) => {
  const fixture = await fixtureForTest(context);
  const cases: Array<{ payload: Record<string, unknown>; status: number }> = [
    { payload: { customer_id: "cust_001", payment_method_id: "pm_valid" }, status: 400 },
    {
      payload: {
        customer_id: "cust_001",
        plan: "enterprise",
        payment_method_id: "pm_valid",
      },
      status: 422,
    },
    {
      payload: {
        customer_id: "cust_missing",
        plan: "basic",
        payment_method_id: "pm_valid",
      },
      status: 422,
    },
    {
      payload: { customer_id: "cust_001", plan: "basic", payment_method_id: "" },
      status: 400,
    },
  ];

  for (const testCase of cases) {
    const response = await fixture.api.createSubscription(testCase.payload);
    assert.equal(response.status, testCase.status);
  }
  assert.equal(fixture.repository.getSubscriptions().length, 0);
  assert.equal(fixture.repository.getInvoices().length, 0);
  assert.equal(fixture.provider.calls.length, 0);
});

test("provider declines and timeouts never create a false successful payment", async (context) => {
  const scenarios: Array<{
    outcome: ChargeResult;
    expectedInvoiceStatus: "failed" | "pending";
  }> = [
    { outcome: { outcome: "declined", reason: "insufficient_funds" }, expectedInvoiceStatus: "failed" },
    { outcome: { outcome: "timeout" }, expectedInvoiceStatus: "pending" },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.outcome.outcome, async (subContext) => {
      const fixture = await fixtureForTest(subContext, [scenario.outcome]);
      const response = await fixture.api.createSubscription(
        subscriptionPayload({ planId: "basic" }),
      );
      const subscription = responseSubscription(response.body);
      const invoice = fixture.repository.getInvoicesForSubscription(subscription.id)[0];

      assert.equal(response.status, 201);
      assert.equal(subscription.status, "past_due");
      assert.equal(invoice?.status, scenario.expectedInvoiceStatus);
      assert.equal(fixture.provider.calls.length, 1);
      assert.equal(
        fixture.repository
          .getInvoicesForSubscription(subscription.id)
          .some((item) => item.status === "paid"),
        false,
      );
    });
  }
});

test("signed success webhook transitions trialing to active and records persistence", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  const event = webhookPayload(subscription.id, {
    eventId: "evt_trial_success",
    invoiceId: "inv_trial_success",
  });
  const response = await fixture.api.sendWebhook(event);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { duplicate: false, outcome: "processed" });
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "active",
  );
  assert.equal(invoiceFor(fixture.repository.getInvoices(), "inv_trial_success").status, "paid");
  assert.equal(
    fixture.repository.getWebhookEvent("evt_trial_success")?.outcome,
    "processed",
  );
  assert.equal(
    fixture.repository.getWebhookDeliveries("evt_trial_success").length,
    1,
  );
});

test("failed first payment transitions trialing to past_due", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  const response = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_trial_failed",
      invoiceId: "inv_trial_failed",
      type: "payment.failed",
      attemptNumber: 1,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "past_due",
  );
  assert.equal(invoiceFor(fixture.repository.getInvoices(), "inv_trial_failed").status, "failed");
  assert.equal(fixture.provider.calls.length, 0);
});

test("recurring payment failure transitions active to past_due", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api, "basic");
  const response = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_recurring_failure",
      invoiceId: "inv_recurring_failure",
      type: "payment.failed",
      amount: 4900,
      attemptNumber: 1,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "past_due",
  );
  assert.equal(
    invoiceFor(fixture.repository.getInvoices(), "inv_recurring_failure").status,
    "failed",
  );
  assert.equal(fixture.provider.calls.length, 1);
});

test("successful retry transitions past_due back to active", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  const failed = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_retry_failed",
      invoiceId: "inv_retry",
      type: "payment.failed",
      attemptNumber: 1,
    }),
  );
  assert.equal(failed.status, 200);
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "past_due",
  );

  const succeeded = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_retry_succeeded",
      invoiceId: "inv_retry",
      type: "payment.succeeded",
      attemptNumber: 2,
    }),
  );
  assert.equal(succeeded.status, 200);
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "active",
  );
  assert.equal(invoiceFor(fixture.repository.getInvoices(), "inv_retry").status, "paid");
});

test("past_due becomes canceled when the retry limit is exhausted", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fixture.api.sendWebhook(
      webhookPayload(subscription.id, {
        eventId: `evt_exhausted_${attempt}`,
        invoiceId: `inv_exhausted_${attempt}`,
        type: "payment.failed",
        attemptNumber: attempt,
      }),
    );
    assert.equal(response.status, 200);
  }

  const persisted = fixture.repository.getSubscription(subscription.id);
  assert.equal(persisted?.status, "canceled");
  assert.equal(persisted?.retryCount, 3);
  assert.ok(
    fixture.repository
      .getAuditRecords(subscription.id)
      .some(
        (record) =>
          record.fromStatus === "past_due" && record.toStatus === "canceled",
      ),
  );
});

test("API cancellation is terminal for active and trialing subscriptions", async (context) => {
  const fixture = await fixtureForTest(context);
  const active = await createSubscription(fixture.api, "basic");
  const trialing = await createSubscription(fixture.api, "pro");

  for (const subscription of [active, trialing]) {
    const canceled = await fixture.api.cancelSubscription(subscription.id);
    assert.equal(canceled.status, 200);
    assert.equal(responseSubscription(canceled.body).status, "canceled");
    const secondCancel = await fixture.api.cancelSubscription(subscription.id);
    assert.equal(secondCancel.status, 409);
  }
  assert.equal(fixture.provider.calls.length, 1);
});

test("past_due cancellation is rejected rather than bypassing retry policy", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_past_due_before_cancel",
      invoiceId: "inv_past_due_before_cancel",
      type: "payment.failed",
    }),
  );

  const response = await fixture.api.cancelSubscription(subscription.id);
  assert.equal(response.status, 409);
  assert.equal(
    fixture.repository.getSubscription(subscription.id)?.status,
    "past_due",
  );
});

test("duplicate webhook delivery is auditable and applies side effects once", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  const payload = webhookPayload(subscription.id, {
    eventId: "evt_duplicate",
    invoiceId: "inv_duplicate",
  });

  const first = await fixture.api.sendWebhook(payload);
  const auditCountAfterFirst = fixture.repository.getAuditRecords(subscription.id).length;
  const second = await fixture.api.sendWebhook(payload);

  assert.deepEqual(first.body, { duplicate: false, outcome: "processed" });
  assert.deepEqual(second.body, { duplicate: true, outcome: "ignored" });
  assert.equal(fixture.repository.getInvoicesForSubscription(subscription.id).length, 1);
  assert.equal(fixture.repository.getWebhookEvent("evt_duplicate")?.deliveryCount, 2);
  assert.equal(
    fixture.repository.getWebhookEvent("evt_duplicate")?.duplicateDeliveries,
    1,
  );
  assert.equal(fixture.repository.getWebhookDeliveries("evt_duplicate").length, 2);
  assert.equal(
    fixture.repository.getWebhookDeliveries("evt_duplicate")[1]?.duplicate,
    true,
  );
  assert.equal(fixture.repository.getAuditRecords(subscription.id).length, auditCountAfterFirst);
  assert.equal(fixture.provider.calls.length, 0);
});

test("a failed event arriving after success does not regress the invoice or subscription", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_order_success",
      invoiceId: "inv_out_of_order",
      type: "payment.succeeded",
    }),
  );
  const auditCount = fixture.repository.getAuditRecords(subscription.id).length;

  const staleFailure = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_order_failure",
      invoiceId: "inv_out_of_order",
      type: "payment.failed",
    }),
  );

  assert.deepEqual(staleFailure.body, { duplicate: false, outcome: "ignored" });
  assert.equal(fixture.repository.getSubscription(subscription.id)?.status, "active");
  assert.equal(invoiceFor(fixture.repository.getInvoices(), "inv_out_of_order").status, "paid");
  assert.equal(fixture.repository.getSubscription(subscription.id)?.retryCount, 0);
  assert.equal(fixture.repository.getAuditRecords(subscription.id).length, auditCount);
});

test("a webhook cannot reactivate a canceled subscription or create an invoice", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  assert.equal((await fixture.api.cancelSubscription(subscription.id)).status, 200);

  const response = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_after_cancel",
      invoiceId: "inv_after_cancel",
      type: "payment.succeeded",
    }),
  );

  assert.deepEqual(response.body, { duplicate: false, outcome: "ignored" });
  assert.equal(fixture.repository.getSubscription(subscription.id)?.status, "canceled");
  assert.equal(fixture.repository.getInvoice("inv_after_cancel"), undefined);
  assert.equal(fixture.provider.calls.length, 0);
});

test("invalid signatures and malformed webhook bodies are rejected at the HTTP boundary", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  const unsigned = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, { eventId: "evt_unsigned" }),
    "missing",
  );
  assert.equal(unsigned.status, 401);

  const invalidSignature = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, { eventId: "evt_bad_signature" }),
    "invalid",
  );
  assert.equal(invalidSignature.status, 401);

  const malformed = await fixture.api.sendWebhookBody("{", "valid");
  assert.equal(malformed.status, 400);

  const invalidShape = await fixture.api.sendWebhook({});
  assert.equal(invalidShape.status, 400);
  assert.equal(fixture.repository.getWebhookEvent("evt_unsigned"), undefined);
  assert.equal(fixture.repository.getWebhookEvent("evt_bad_signature"), undefined);
  assert.equal(fixture.repository.getWebhookEvent("evt_test_001"), undefined);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.status, "trialing");
});

test("webhook amount mismatch is rejected without persistence", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);

  const response = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_wrong_amount",
      invoiceId: "inv_wrong_amount",
      amount: webhookAmount - 1,
    }),
  );

  assert.equal(response.status, 422);
  assert.equal(fixture.repository.getWebhookEvent("evt_wrong_amount"), undefined);
  assert.equal(fixture.repository.getInvoice("inv_wrong_amount"), undefined);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.status, "trialing");
});

test("refund is persisted without changing the subscription lifecycle", async (context) => {
  const fixture = await fixtureForTest(context);
  const subscription = await createSubscription(fixture.api);
  await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_before_refund",
      invoiceId: "inv_refund",
      type: "payment.succeeded",
    }),
  );

  const refund = await fixture.api.sendWebhook(
    webhookPayload(subscription.id, {
      eventId: "evt_refund",
      invoiceId: "inv_refund",
      type: "payment.refunded",
    }),
  );

  assert.equal(refund.status, 200);
  assert.equal(fixture.repository.getSubscription(subscription.id)?.status, "active");
  assert.equal(invoiceFor(fixture.repository.getInvoices(), "inv_refund").status, "refunded");
});
