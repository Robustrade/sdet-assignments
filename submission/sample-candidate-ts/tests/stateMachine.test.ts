import { buildTestHarness, TestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder, WebhookEventBuilder } from "./support/builders";

async function createTrialSubscription(harness: TestHarness) {
  const resp = await harness.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
  return { subscriptionId: resp.body.id as string, invoiceId: resp.body.invoiceId as string };
}

describe("subscription lifecycle state machine", () => {
  test("trialing -> active via a successful trial-end webhook", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);

    const webhook = new WebhookEventBuilder()
      .withType("payment.succeeded")
      .forSubscription(subscriptionId)
      .forInvoice(invoiceId)
      .build();
    const resp = await harness.api.sendWebhook(webhook);

    expect(resp.status).toBe(200);
    expect(resp.body.applied).toBe(true);
    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("active");
    expect(harness.repository.getInvoice(invoiceId)?.status).toBe("paid");
  });

  test("trialing -> past_due via a failed trial-end webhook", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);

    await harness.api.sendWebhook(
      new WebhookEventBuilder().withType("payment.failed").forSubscription(subscriptionId).forInvoice(invoiceId).build(),
    );

    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("past_due");
  });

  test("past_due -> active once a retry succeeds", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);
    await harness.api.sendWebhook(
      new WebhookEventBuilder().withType("payment.failed").forSubscription(subscriptionId).forInvoice(invoiceId).build(),
    );

    await harness.api.sendWebhook(
      new WebhookEventBuilder()
        .withEventId("evt_retry_success")
        .withType("payment.succeeded")
        .forSubscription(subscriptionId)
        .forInvoice(invoiceId)
        .build(),
    );

    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("active");
  });

  test("past_due -> canceled once retries are exhausted", async () => {
    const harness = buildTestHarness();
    const created = await harness.api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("basic").build(), // basic: maxPaymentRetries = 2
    );
    const subscriptionId = created.body.id;
    // The first invoice was already paid at creation; retries apply to the
    // *next* billing cycle's invoice, same as a real recurring charge.
    const { invoiceId } = harness.service.openNextInvoice(subscriptionId);

    // First failure: active -> past_due.
    await harness.api.sendWebhook(
      new WebhookEventBuilder()
        .withEventId("evt_fail_1")
        .withType("payment.failed")
        .forSubscription(subscriptionId)
        .forInvoice(invoiceId)
        .build(),
    );
    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("past_due");

    // Second failure: retries exhausted -> canceled.
    await harness.api.sendWebhook(
      new WebhookEventBuilder()
        .withEventId("evt_fail_2")
        .withType("payment.failed")
        .forSubscription(subscriptionId)
        .forInvoice(invoiceId)
        .build(),
    );

    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("canceled");
  });

  test("active -> canceled via the cancel API", async () => {
    const harness = buildTestHarness();
    const created = await harness.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    const cancelResp = await harness.api.cancelSubscription(created.body.id);

    expect(cancelResp.status).toBe(200);
    expect(cancelResp.body.status).toBe("canceled");
  });

  test("invalid transition: a payment.succeeded webhook cannot reactivate a canceled subscription", async () => {
    const harness = buildTestHarness();
    const created = await harness.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    await harness.api.cancelSubscription(created.body.id);

    const resp = await harness.api.sendWebhook(
      new WebhookEventBuilder()
        .withType("payment.succeeded")
        .forSubscription(created.body.id)
        .forInvoice(created.body.invoiceId)
        .build(),
    );

    expect(resp.body.applied).toBe(false);
    expect(harness.repository.getSubscription(created.body.id)?.status).toBe("canceled");
  });

  test("invalid transition: a stale payment.failed webhook does not regress an already-paid invoice", async () => {
    // Reproduces out-of-order delivery: payment.failed arrives after
    // payment.succeeded already resolved the same invoice.
    const harness = buildTestHarness();
    const created = await harness.api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    // Creation already synchronously charged and marked the invoice paid.

    const staleFailure = await harness.api.sendWebhook(
      new WebhookEventBuilder()
        .withType("payment.failed")
        .forSubscription(created.body.id)
        .forInvoice(created.body.invoiceId)
        .build(),
    );

    expect(staleFailure.body.applied).toBe(false);
    expect(harness.repository.getSubscription(created.body.id)?.status).toBe("active");
    expect(harness.repository.getInvoice(created.body.invoiceId)?.status).toBe("paid");
  });
});
