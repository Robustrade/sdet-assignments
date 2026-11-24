
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";

describe("Subscription service", () => {
  let service: SubscriptionService;
  let repository: InMemorySubscriptionRepository;

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
    service = new SubscriptionService(
      repository,
      new SubscriptionStateMachine()
    );
  });

  test("creates a subscription in trialing state", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    expect(subscription.id).toBeDefined();
    expect(subscription.status).toBe("trialing");

    const saved = await repository.findById(subscription.id);
    expect(saved?.status).toBe("trialing");
  });

  test("rejects missing customer ID", async () => {
    await expect(
      service.createSubscription("", "plan_basic")
    ).rejects.toThrow("Customer ID and Plan ID are required");
  });

  test("activates a trialing subscription", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    const updated = await service.changeStatus(
      subscription.id,
      "active"
    );

    expect(updated.status).toBe("active");

    const saved = await repository.findById(subscription.id);
    expect(saved?.status).toBe("active");
  });

  test("rejects invalid state transitions", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    await expect(
      service.changeStatus(subscription.id, "past_due")
    ).resolves.toMatchObject({ status: "past_due" });

    await expect(
      service.changeStatus(subscription.id, "trialing")
    ).rejects.toThrow("Invalid subscription transition");
  });

  test("rejects unknown subscriptions", async () => {
    await expect(
      service.changeStatus("unknown", "active")
    ).rejects.toThrow("Subscription not found");
  });

  test("retrieves a subscription by ID", async () => {
    const created = await service.createSubscription(
      "cust_002",
      "plan_premium"
    );

    const retrieved = await service.getSubscription(created.id);

    expect(retrieved).toEqual(created);
  });
});
