import { SubscriptionBuilder } from "../../src/models/Subscription";

describe("SubscriptionBuilder", () => {
  test("creates a subscription with default values", () => {
    const subscription = new SubscriptionBuilder().build();

    expect(subscription.customerId).toBe("cus_test_001");
    expect(subscription.plan).toBe("basic");
    expect(subscription.status).toBe("trialing");
  });

  test("creates a subscription with custom values", () => {
    const subscription = new SubscriptionBuilder()
      .withId("sub_123")
      .withCustomerId("cus_123")
      .withPlan("pro")
      .withStatus("active")
      .build();

    expect(subscription.id).toBe("sub_123");
    expect(subscription.customerId).toBe("cus_123");
    expect(subscription.plan).toBe("pro");
    expect(subscription.status).toBe("active");
  });
});
