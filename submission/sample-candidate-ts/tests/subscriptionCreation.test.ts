import { buildTestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder } from "./support/builders";

describe("subscription creation", () => {
  test("a no-trial plan is charged synchronously and becomes active", async () => {
    const { api, repository, paymentProvider } = buildTestHarness();

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    expect(resp.status).toBe(201);
    expect(resp.body.status).toBe("active");
    expect(paymentProvider.callCount).toBe(1);

    const invoice = repository.listInvoicesForSubscription(resp.body.id)[0];
    expect(invoice.status).toBe("paid");
    expect(invoice.amountCents).toBe(1900);
  });

  test("a trial plan starts trialing without charging the provider", async () => {
    const { api, repository, paymentProvider } = buildTestHarness();

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());

    expect(resp.status).toBe(201);
    expect(resp.body.status).toBe("trialing");
    expect(paymentProvider.callCount).toBe(0);

    const invoice = repository.listInvoicesForSubscription(resp.body.id)[0];
    expect(invoice.status).toBe("pending");
  });

  test("a declined charge on a no-trial plan leaves the subscription past_due, not active", async () => {
    const { api, repository, paymentProvider } = buildTestHarness();
    paymentProvider.setDefaultOutcome("declined");

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    expect(resp.body.status).toBe("past_due");
    const invoice = repository.listInvoicesForSubscription(resp.body.id)[0];
    expect(invoice.status).toBe("failed");
  });

  test("a provider timeout is treated the same as a decline, not a silent success", async () => {
    const { api, paymentProvider } = buildTestHarness();
    paymentProvider.setDefaultOutcome("timeout");

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    expect(resp.body.status).toBe("past_due");
  });

  test("creation records a single audit event and a single persisted subscription", async () => {
    const { api, repository } = buildTestHarness();

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    expect(repository.countSubscriptions()).toBe(1);
    // subscription_created + first_charge_succeeded
    expect(repository.countAuditEvents(resp.body.id)).toBe(2);
  });
});
