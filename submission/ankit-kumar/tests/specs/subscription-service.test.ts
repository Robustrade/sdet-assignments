import { describe, expect, it } from "vitest";
import { SubscriptionService } from "../../src/application/subscription-service";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { FakePaymentProvider } from "../support/fake-payment-provider";

describe("Subscription Service", () => {
  it("creates a basic subscription with a 7-day trial without charging", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const subscriptions = new SubscriptionRepository(database);
      const provider = new FakePaymentProvider();

      customers.save({ id: "cust_001", name: "Ankit Kumar" });

      const service = new SubscriptionService({
        customerRepository: customers,
        subscriptionRepository: subscriptions,
        paymentProvider: provider,
        now: () => new Date("2026-11-13T10:00:00.000Z")
      });

      const result = await service.createSubscription({
        customerId: "cust_001",
        plan: "basic",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(result.status).toBe("trialing");
      expect(result.trialEndsAt).toBe("2026-11-20T10:00:00.000Z");
      expect(subscriptions.findById(result.id)).toEqual(result);
      expect(provider.callCount).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects an unknown customer without creating a subscription or charging", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const subscriptions = new SubscriptionRepository(database);
      const provider = new FakePaymentProvider();

      const service = new SubscriptionService({
        customerRepository: customers,
        subscriptionRepository: subscriptions,
        paymentProvider: provider
      });

      await expect(
        service.createSubscription({
          customerId: "cust_unknown",
          plan: "basic",
          paymentMethodId: "pm_test_visa_4242"
        })
      ).rejects.toThrow("Customer not found");

      const count = database.get<{ total: number }>(
        "SELECT COUNT(*) AS total FROM subscriptions"
      );

      expect(count?.total).toBe(0);
      expect(provider.callCount).toBe(0);
    } finally {
      database.close();
    }
  });
});