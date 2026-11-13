import { describe, expect, it } from "vitest";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";

describe("Subscription Repository", () => {
  it("persists and retrieves a subscription", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const repository = new SubscriptionRepository(database);

      customers.save({
        id: "cust_001",
        name: "Ankit Kumar"
      });

      const subscription = {
        id: "sub_001",
        customerId: "cust_001",
        plan: "pro",
        paymentMethodId: "pm_test_visa_4242",
        status: "trialing" as const,
        createdAt: "2026-11-13T10:00:00.000Z",
        updatedAt: "2026-11-13T10:00:00.000Z"
      };

      repository.save(subscription);

      expect(repository.findById("sub_001")).toEqual(subscription);
    } finally {
      database.close();
    }
  });

  it("updates the persisted subscription status", async () => {
    const database = await TestDatabase.create();

    try {
      const customers = new CustomerRepository(database);
      const repository = new SubscriptionRepository(database);

      customers.save({
        id: "cust_002",
        name: "Ankit Kumar"
      });

      repository.save({
        id: "sub_002",
        customerId: "cust_002",
        plan: "basic",
        paymentMethodId: "pm_test_visa_4242",
        status: "trialing",
        createdAt: "2026-11-13T10:00:00.000Z",
        updatedAt: "2026-11-13T10:00:00.000Z"
      });

      repository.updateStatus(
        "sub_002",
        "active",
        "2026-11-13T10:05:00.000Z"
      );

      expect(repository.findById("sub_002")?.status).toBe("active");
    } finally {
      database.close();
    }
  });
});