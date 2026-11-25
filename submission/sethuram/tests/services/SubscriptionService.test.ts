
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";

describe("Subscription service", () => {
  let service: SubscriptionService;
  let repository: InMemorySubscriptionRepository;
  let invoiceRepository: InMemoryInvoiceRepository;

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
    invoiceRepository = new InMemoryInvoiceRepository();

    service = new SubscriptionService(
      repository,
      new SubscriptionStateMachine(),
      undefined,
      undefined,
      invoiceRepository
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

  test("activates a trialing subscription after successful payment", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    await invoiceRepository.save({
      id: "inv_001",
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      amount: 1900,
      currency: "USD",
      status: "paid",
      idempotencyKey: "billing_001",
      transactionId: "txn_success",
      createdAt: new Date(),
      updatedAt: new Date()
    });

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
      "plan_basic"
    );

    const retrieved = await service.getSubscription(created.id);

    expect(retrieved).toEqual(created);
  });
  test("creates basic subscription with a 14-day trial", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    const expectedTrialEnd = new Date(
      subscription.createdAt.getTime() +
      14 * 24 * 60 * 60 * 1000
    );

    expect(subscription.status).toBe("trialing");
    expect(subscription.trialEndsAt).toEqual(expectedTrialEnd);
  });
  test("creates pro subscription without a free trial", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_pro"
    );

    expect(subscription.trialEndsAt).toBeUndefined();
  });
  test("persists the subscription trial expiry date", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    const saved = await repository.findById(
      subscription.id
    );

    const expectedTrialEnd = new Date(
      subscription.createdAt.getTime() +
      14 * 24 * 60 * 60 * 1000
    );

    expect(saved).not.toBeNull();
    expect(saved?.trialEndsAt).toEqual(expectedTrialEnd);
  });
  test("prevents subscription activation without a successful payment", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    await expect(
      service.changeStatus(subscription.id, "active")
    ).rejects.toThrow(
      "Cannot activate subscription without a successful payment"
    );

    const stored = await repository.findById(
      subscription.id
    );

    expect(stored?.status).toBe("trialing");
  });
  test("prevents payment outcome activation without a successful invoice", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    await expect(
      service.recordPaymentOutcome(subscription.id, true)
    ).rejects.toThrow(
      "Cannot activate subscription without a successful payment"
    );

    const saved = await repository.findById(subscription.id);

    expect(saved?.status).toBe("trialing");
  });
  test("prevents activation when only a failed invoice exists", async () => {
    const subscription = await service.createSubscription(
      "cust_001",
      "plan_basic"
    );

    await invoiceRepository.save({
      id: "inv_failed",
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      amount: 1900,
      currency: "USD",
      status: "failed",
      idempotencyKey: "billing_failed",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await expect(
      service.changeStatus(subscription.id, "active")
    ).rejects.toThrow(
      "Cannot activate subscription without a successful payment"
    );

    const saved = await repository.findById(subscription.id);

    expect(saved?.status).toBe("trialing");
  });
});
