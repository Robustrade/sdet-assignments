
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/api/app";
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { InMemoryBillingRepository } from "../../src/persistence/InMemoryBillingRepository";
import { FakePaymentProvider } from "../../src/payments/FakePaymentProvider";

describe("Subscription cancellation API", () => {
  let repository: InMemoryBillingRepository;
  let provider: FakePaymentProvider;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    provider = new FakePaymentProvider();

    repository.saveCustomer({
      id: "cust_001",
      email: "customer@example.com",
      paymentMethodId: "pm_test_visa_4242",
    });

    const service = new SubscriptionService(repository, provider);
    app = createApp(service, repository);
  });

  async function createTrialSubscription(): Promise<string> {
    const response = await request(app)
      .post("/subscriptions")
      .send({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  it("cancels a trialing subscription and persists the audit event", async () => {
    const subscriptionId = await createTrialSubscription();

    const response = await request(app)
      .post(`/subscriptions/${subscriptionId}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("canceled");
    expect(response.body.canceledAt).toEqual(expect.any(String));

    expect(repository.getSubscription(subscriptionId)).toMatchObject({
      id: subscriptionId,
      status: "canceled",
    });

    const auditEvents =
      repository.getAuditEventsForSubscription(subscriptionId);

    expect(auditEvents.at(-1)).toMatchObject({
      fromStatus: "trialing",
      toStatus: "canceled",
      reason: "customer_canceled",
    });

    expect(provider.getCallCount()).toBe(0);
  });

  it("rejects cancellation when the subscription is already canceled", async () => {
    const subscriptionId = await createTrialSubscription();

    const firstResponse = await request(app)
      .post(`/subscriptions/${subscriptionId}/cancel`);

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post(`/subscriptions/${subscriptionId}/cancel`);

    expect(secondResponse.status).toBe(409);
    expect(repository.getSubscription(subscriptionId)?.status).toBe(
      "canceled",
    );
    expect(provider.getCallCount()).toBe(0);
  });
});
