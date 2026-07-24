import { buildTestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder, WebhookEventBuilder } from "./support/builders";
import { WebhookEventPayload } from "../src/domain/types";

async function createTrialSubscription(harness: ReturnType<typeof buildTestHarness>) {
  const resp = await harness.api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());
  return { subscriptionId: resp.body.id as string, invoiceId: resp.body.invoiceId as string };
}

describe("webhook delivery", () => {
  test("redelivering the same event_id applies the transition exactly once", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);
    const webhook = new WebhookEventBuilder()
      .withEventId("evt_fixed_001")
      .withType("payment.succeeded")
      .forSubscription(subscriptionId)
      .forInvoice(invoiceId)
      .build();

    const first = await harness.api.sendWebhook(webhook);
    const second = await harness.api.sendWebhook(webhook);

    expect(first.body.applied).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(false);
    expect(second.body.reason).toBe("duplicate_event");
    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("active");
  });

  test("a duplicate webhook does not create a second audit event for the same transition", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);
    const webhook = new WebhookEventBuilder()
      .withEventId("evt_fixed_002")
      .withType("payment.succeeded")
      .forSubscription(subscriptionId)
      .forInvoice(invoiceId)
      .build();

    await harness.api.sendWebhook(webhook);
    const before = harness.repository.countAuditEvents(subscriptionId);
    await harness.api.sendWebhook(webhook);
    const after = harness.repository.countAuditEvents(subscriptionId);

    expect(after).toBe(before);
  });

  test("a request without a signature header is rejected", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);
    const webhook = new WebhookEventBuilder().forSubscription(subscriptionId).forInvoice(invoiceId).build();

    const resp = await harness.api.sendWebhook(webhook, null);

    expect(resp.status).toBe(400);
  });

  test("a request with an incorrect signature is rejected", async () => {
    const harness = buildTestHarness();
    const { subscriptionId, invoiceId } = await createTrialSubscription(harness);
    const webhook = new WebhookEventBuilder().forSubscription(subscriptionId).forInvoice(invoiceId).build();

    const resp = await harness.api.sendWebhook(webhook, "0".repeat(64));

    expect(resp.status).toBe(401);
    expect(harness.repository.getSubscription(subscriptionId)?.status).toBe("trialing");
  });

  test("a malformed payload (missing required fields) is rejected before touching state", async () => {
    const harness = buildTestHarness();

    const resp = await harness.api.sendWebhook({
      eventId: "evt_malformed",
      type: "payment.succeeded",
    } as unknown as WebhookEventPayload);

    expect(resp.status).toBe(400);
  });

  test("a webhook referencing an unknown subscription returns 404", async () => {
    const harness = buildTestHarness();

    const resp = await harness.api.sendWebhook(
      new WebhookEventBuilder().forSubscription("sub_missing").forInvoice("inv_missing").build(),
    );

    expect(resp.status).toBe(404);
  });
});
