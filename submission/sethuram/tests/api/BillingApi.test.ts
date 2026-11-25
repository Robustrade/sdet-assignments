
import { createApp } from "../../src/app";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";

describe("Billing API integration", () => {
  let client: SubscriptionApiClient;
  let subscriptionId: string;

  const payment = {
    paymentMethodId: "pm_test_visa_4242",
    idempotencyKey: "billing_001"
  };

  beforeEach(async () => {
    client = new SubscriptionApiClient(createApp());

    const response = await client.createSubscription({
      customerId: "cust_001",
      planId: "plan_basic"
    });

    expect(response.status).toBe(201);

    subscriptionId = response.body.id;
  });

  test("successfully bills a subscription", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(response.status).toBe(200);
    expect(response.body.id).toBeDefined();
    expect(response.body.status).toBe("paid");
  });

  test("returns correct subscription and customer IDs", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(response.status).toBe(200);
    expect(response.body.subscriptionId).toBe(subscriptionId);
    expect(response.body.customerId).toBe("cust_001");
  });

  test("returns correct billing currency", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(response.status).toBe(200);
    expect(response.body.currency).toBe("USD");
  });

  test("activates subscription after successful payment", async () => {
    const billed = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(billed.status).toBe(200);

    const response = await client.getSubscription(
      subscriptionId
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("active");
  });

  test("rejects missing payment method", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      {
        idempotencyKey: "billing_002"
      }
    );

    expect(response.status).toBe(400);
  });

  test("rejects missing idempotency key", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      {
        paymentMethodId: "pm_test_visa_4242"
      }
    );

    expect(response.status).toBe(400);
  });

  test("rejects empty payment method", async () => {
    const response = await client.billSubscription(
      subscriptionId,
      {
        paymentMethodId: "",
        idempotencyKey: "billing_003"
      }
    );

    expect(response.status).toBe(400);
  });

  test("returns 404 for unknown subscription", async () => {
    const response = await client.billSubscription(
      "unknown_id",
      payment
    );

    expect(response.status).toBe(404);
  });

  test("returns same invoice for duplicate billing request", async () => {
    const first = await client.billSubscription(
      subscriptionId,
      payment
    );

    const second = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.id).toBeDefined();
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.status).toBe("paid");
  });

  test("rejects idempotency key conflict", async () => {
    const first = await client.billSubscription(
      subscriptionId,
      payment
    );

    expect(first.status).toBe(200);

    const another = await client.createSubscription({
      customerId: "cust_002",
      planId: "plan_basic"
    });

    expect(another.status).toBe(201);

    const response = await client.billSubscription(
      another.body.id,
      payment
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "Idempotency key conflict"
    );
  });
});
