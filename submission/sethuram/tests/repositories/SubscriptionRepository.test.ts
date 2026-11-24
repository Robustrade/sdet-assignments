
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { Subscription } from "../../src/domain/Subscription";

describe("Subscription repository persistence", () => {
  let repository: InMemorySubscriptionRepository;

  const subscription: Subscription = {
    id: "sub_001",
    customerId: "cust_001",
    planId: "plan_basic",
    status: "trialing",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
  });

  test("saves and retrieves a subscription", async () => {
    await repository.save(subscription);

    const saved = await repository.findById("sub_001");

    expect(saved).toEqual(subscription);
  });

  test("returns null for unknown subscription", async () => {
    const saved = await repository.findById("unknown");

    expect(saved).toBeNull();
  });

  test("persists subscription status updates", async () => {
    await repository.save(subscription);

    await repository.save({
      ...subscription,
      status: "active",
      updatedAt: new Date("2026-01-02T00:00:00Z")
    });

    const saved = await repository.findById("sub_001");

    expect(saved?.status).toBe("active");
  });

  test("returns all saved subscriptions", async () => {
    await repository.save(subscription);
    await repository.save({
      ...subscription,
      id: "sub_002"
    });

    const all = await repository.findAll();

    expect(all).toHaveLength(2);
  });

  test("protects stored data from external mutation", async () => {
    await repository.save(subscription);

    const saved = await repository.findById("sub_001");

    if (!saved) {
      throw new Error("Subscription not found");
    }

    saved.status = "canceled";

    const stored = await repository.findById("sub_001");

    expect(stored?.status).toBe("trialing");
  });
});
