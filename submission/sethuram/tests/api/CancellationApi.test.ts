
import { createApp } from "../../src/app";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";

describe("Subscription cancellation API", () => {
  let client: SubscriptionApiClient;
  let subscriptionId: string;

  beforeEach(async () => {
    client = new SubscriptionApiClient(createApp());

    const response = await client.createSubscription({
  customerId: "cust_001",
  planId: "plan_basic"
});

    expect(response.status).toBe(201);

    subscriptionId = response.body.id;
  });

  test("cancels a trialing subscription", async () => {
    const response = await client.cancelSubscription(
      subscriptionId
    );

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(subscriptionId);
    expect(response.body.status).toBe("canceled");
  });

  test("cancels an active subscription", async () => {
    const billing = await client.billSubscription(
      subscriptionId,
      {
        paymentMethodId: "pm_test_visa_4242",
        idempotencyKey: "cancel_active_001"
      }
    );

    expect(billing.status).toBe(200);
    expect(billing.body.status).toBe("paid");

    const beforeCancel = await client.getSubscription(
      subscriptionId
    );

    expect(beforeCancel.body.status).toBe("active");

    const response = await client.cancelSubscription(
      subscriptionId
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("canceled");
  });

  test("returns 404 for an unknown subscription", async () => {
    const response = await client.cancelSubscription(
      "unknown_id"
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Subscription not found"
    );
  });

  test("rejects cancellation of an already canceled subscription", async () => {
    const first = await client.cancelSubscription(
      subscriptionId
    );

    expect(first.status).toBe(200);

    const second = await client.cancelSubscription(
      subscriptionId
    );

    expect(second.status).toBe(409);
    expect(second.body.error).toBe(
      "Subscription is already canceled"
    );
  });

  test("persists the canceled subscription state", async () => {
    const canceled = await client.cancelSubscription(
      subscriptionId
    );

    expect(canceled.status).toBe(200);

    const retrieved = await client.getSubscription(
      subscriptionId
    );

    expect(retrieved.status).toBe(200);
    expect(retrieved.body.id).toBe(subscriptionId);
    expect(retrieved.body.status).toBe("canceled");
    expect(retrieved.body.customerId).toBe("cust_001");
    expect(retrieved.body.planId).toBe("plan_basic");
    expect(retrieved.body).toEqual(canceled.body);
  });

  test("prevents future billing after cancellation", async () => {
    const canceled = await client.cancelSubscription(
      subscriptionId
    );

    expect(canceled.status).toBe(200);

    const billing = await client.billSubscription(
      subscriptionId,
      {
        paymentMethodId: "pm_test_visa_4242",
        idempotencyKey: "canceled_billing_001"
      }
    );

    expect(billing.status).toBe(400);
    expect(billing.body.error).toBe(
      "Cannot bill a canceled subscription"
    );

    const subscription = await client.getSubscription(
      subscriptionId
    );

    expect(subscription.body.status).toBe("canceled");
  });
});
