import { describe, expect, it } from "vitest";
import { SubscriptionService } from "../../src/application/subscription-service";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { FakePaymentProvider } from "../support/fake-payment-provider";

describe("Subscription Request Validation", () => {
  it("rejects an unknown plan without saving or charging", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const subscriptions = new SubscriptionRepository(database);
      const provider = new FakePaymentProvider();

      customers.save({ id: "cust_001", name: "Ankit Kumar" });

      const service = new SubscriptionService({
        customerRepository: customers,
        subscriptionRepository: subscriptions,
        paymentProvider: provider
      });

      await expect(
        service.createSubscription({
          customerId: "cust_001",
          plan: "enterprise",
          paymentMethodId: "pm_test_visa_4242"
        })
      ).rejects.toThrow("Invalid plan");

      expect(
        database.get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM subscriptions"
        )?.total
      ).toBe(0);

      expect(provider.callCount).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects a missing payment method without saving or charging", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const subscriptions = new SubscriptionRepository(database);
      const provider = new FakePaymentProvider();

      customers.save({ id: "cust_001", name: "Ankit Kumar" });

      const service = new SubscriptionService({
        customerRepository: customers,
        subscriptionRepository: subscriptions,
        paymentProvider: provider
      });

      await expect(
        service.createSubscription({
          customerId: "cust_001",
          plan: "basic",
          paymentMethodId: " "
        })
      ).rejects.toThrow("Payment method is required");

      expect(
        database.get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM subscriptions"
        )?.total
      ).toBe(0);

      expect(provider.callCount).toBe(0);
    } finally {
      database.close();
    }
  });
});