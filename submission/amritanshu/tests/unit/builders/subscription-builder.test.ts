import { describe, expect, it } from "vitest";

import { SubscriptionBuilder } from "../../../src/builders/subscription-builder.js";

describe("SubscriptionBuilder", () => {
  it("should build a subscription with default values", () => {
    const subscription = new SubscriptionBuilder().build();

    expect(subscription.id).toBe("sub_001");
    expect(subscription.customerId).toBe("cust_001");
    expect(subscription.planId).toBe("pro");
    expect(subscription.paymentMethodId).toBe(
      "pm_test_visa_4242",
    );
    expect(subscription.state).toBe("trialing");
    expect(subscription.createdAt).toBeInstanceOf(Date);
  });

  it("should allow subscription properties to be customized", () => {
    const subscription = new SubscriptionBuilder()
      .withId("sub_123")
      .withCustomerId("cust_123")
      .withPlanId("basic")
      .withPaymentMethodId("pm_test_mastercard")
      .withState("past_due")
      .build();

    expect(subscription).toMatchObject({
      id: "sub_123",
      customerId: "cust_123",
      planId: "basic",
      paymentMethodId: "pm_test_mastercard",
      state: "past_due",
    });
  });
});