import { buildTestHarness } from "./support/testApp";
import { SubscriptionRequestBuilder } from "./support/builders";

describe("validation failures", () => {
  test("missing customerId is rejected without touching the provider or persistence", async () => {
    const { api, repository, paymentProvider } = buildTestHarness();

    const resp = await api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("basic").omitting("customerId").build(),
    );

    expect(resp.status).toBe(422);
    expect(resp.body.fields).toContain("customerId");
    expect(repository.countSubscriptions()).toBe(0);
    expect(paymentProvider.callCount).toBe(0);
  });

  test("missing paymentMethodId is rejected", async () => {
    const { api } = buildTestHarness();

    const resp = await api.createSubscription(
      new SubscriptionRequestBuilder().omitting("paymentMethodId").build(),
    );

    expect(resp.status).toBe(422);
    expect(resp.body.fields).toContain("paymentMethodId");
  });

  test("an unknown plan is rejected without calling the payment provider", async () => {
    const { api, paymentProvider } = buildTestHarness();

    const resp = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("enterprise").build());

    expect(resp.status).toBe(422);
    expect(paymentProvider.callCount).toBe(0);
  });

  test("canceling an already-canceled subscription is rejected", async () => {
    const { api } = buildTestHarness();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan("basic").build());

    await api.cancelSubscription(created.body.id);
    const secondCancel = await api.cancelSubscription(created.body.id);

    expect(secondCancel.status).toBe(409);
  });

  test("canceling an unknown subscription returns 404", async () => {
    const { api } = buildTestHarness();

    const resp = await api.cancelSubscription("sub_does_not_exist");

    expect(resp.status).toBe(404);
  });
});
