import { buildTestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder, WebhookEventBuilder } from "./support/builders";

describe("persistence and auditability", () => {
  test("the API response and the persisted subscription agree", async () => {
    const { api, repository } = buildTestHarness();

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());
    const stored = repository.getSubscription(resp.body.id);

    expect(stored?.status).toBe(resp.body.status);
    expect(stored?.plan).toBe(resp.body.plan);
  });

  test("GET /subscriptions/:id reflects state changes made via webhook", async () => {
    const { api } = buildTestHarness();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());

    await api.sendWebhook(
      new WebhookEventBuilder()
        .withType("payment.succeeded")
        .forSubscription(created.body.id)
        .forInvoice(created.body.invoiceId)
        .build(),
    );
    const getResp = await api.getSubscription(created.body.id);

    expect(getResp.body.status).toBe("active");
  });

  test("a refund webhook is recorded without mutating subscription lifecycle state", async () => {
    const { api, repository } = buildTestHarness();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    await api.sendWebhook(
      new WebhookEventBuilder()
        .withType("payment.refunded")
        .forSubscription(created.body.id)
        .forInvoice(created.body.invoiceId)
        .build(),
    );

    expect(repository.getSubscription(created.body.id)?.status).toBe("active");
    expect(repository.getInvoice(created.body.invoiceId)?.status).toBe("refunded");
  });

  test("no contradictory records: an active subscription always has a paid invoice on file", async () => {
    const { api, repository } = buildTestHarness();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    const subscription = repository.getSubscription(created.body.id);
    const invoices = repository.listInvoicesForSubscription(created.body.id);

    expect(subscription?.status).toBe("active");
    expect(invoices.some((inv) => inv.status === "paid")).toBe(true);
  });

  test("processed webhook events are tracked so duplicate detection survives across requests", async () => {
    const { api, repository } = buildTestHarness();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());

    expect(repository.countProcessedWebhookEvents()).toBe(0);
    await api.sendWebhook(
      new WebhookEventBuilder()
        .withType("payment.succeeded")
        .forSubscription(created.body.id)
        .forInvoice(created.body.invoiceId)
        .build(),
    );
    expect(repository.countProcessedWebhookEvents()).toBe(1);
  });
});
