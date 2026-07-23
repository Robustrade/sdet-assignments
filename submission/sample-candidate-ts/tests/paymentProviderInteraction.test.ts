import { buildTestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder } from "./support/builders";

describe("mock payment provider interaction", () => {
  test("the provider is called once with the correct charge details", async () => {
    const { api, paymentProvider } = buildTestHarness();

    const resp = await api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("basic").withCustomer("cust_42").withPaymentMethod("pm_42").build(),
    );

    expect(paymentProvider.callCount).toBe(1);
    expect(paymentProvider.calls[0]).toMatchObject({
      customerId: "cust_42",
      paymentMethodId: "pm_42",
      amountCents: 1900,
      currency: "USD",
      reference: resp.body.invoiceId,
    });
  });

  test("the provider is never called for a trial plan at creation time", async () => {
    const { api, paymentProvider } = buildTestHarness();

    await api.createSubscription(new SubscriptionRequestBuilder().withPlan("pro").build());

    expect(paymentProvider.callCount).toBe(0);
  });

  test("the provider is never called when creation fails validation", async () => {
    const { api, paymentProvider } = buildTestHarness();

    await api.createSubscription(new SubscriptionRequestBuilder().withPlan("not-a-real-plan").build());

    expect(paymentProvider.callCount).toBe(0);
  });

  test("a decline is reflected in the persisted invoice, not silently upgraded to paid", async () => {
    const { api, repository, paymentProvider } = buildTestHarness();
    paymentProvider.setDefaultOutcome("declined");

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    expect(repository.getInvoice(resp.body.invoiceId)?.status).toBe("failed");
  });

  test("two separate subscriptions each trigger their own, independent provider call", async () => {
    const { api, paymentProvider } = buildTestHarness();

    await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").withCustomer("cust_a").build());
    await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").withCustomer("cust_b").build());

    expect(paymentProvider.callCount).toBe(2);
    expect(paymentProvider.calls.map((c) => c.customerId)).toEqual(["cust_a", "cust_b"]);
  });
});
