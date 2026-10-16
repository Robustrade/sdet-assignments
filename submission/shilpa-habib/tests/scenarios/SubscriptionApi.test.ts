import { beforeEach, describe, expect, it } from "vitest"; import request from "supertest";

import { createApp } from "../../src/api/app"; import { SubscriptionService } from "../../src/services/SubscriptionService"; import { InMemoryBillingRepository } from "../../src/persistence/InMemoryBillingRepository"; import { FakePaymentProvider } from "../../src/payments/FakePaymentProvider";

describe("Subscription API", () => { let repository: InMemoryBillingRepository; let provider: FakePaymentProvider; let app: ReturnType<typeof createApp>;

beforeEach(() => { repository = new InMemoryBillingRepository(); provider = new FakePaymentProvider();

repository.saveCustomer({
  id: "cust_001",
  email: "customer@example.com",
  paymentMethodId: "pm_test_visa_4242",
});

const service = new SubscriptionService(repository, provider);
app = createApp(service, repository);


});

it("creates a pro subscription and returns HTTP 201", async () => { const response = await request(app) .post("/subscriptions") .send({ customer_id: "cust_001", plan: "pro", payment_method_id: "pm_test_visa_4242", });

expect(response.status).toBe(201);
expect(response.body.customerId).toBe("cust_001");
expect(response.body.plan).toBe("pro");
expect(response.body.status).toBe("trialing");

expect(
  repository.getSubscription(response.body.id),
).toEqual(response.body);

expect(provider.getCallCount()).toBe(0);


});

it("returns HTTP 200 when retrieving an existing subscription", async () => { const created = await request(app) .post("/subscriptions") .send({ customer_id: "cust_001", plan: "pro", payment_method_id: "pm_test_visa_4242", });

const response = await request(app).get(
  `/subscriptions/${created.body.id}`,
);

expect(response.status).toBe(200);
expect(response.body.id).toBe(created.body.id);
expect(response.body.status).toBe("trialing");


});

it("returns HTTP 404 for an unknown subscription", async () => { const response = await request(app).get("/subscriptions/sub_missing");

expect(response.status).toBe(404);
expect(response.body.error).toBe("Subscription not found");


});

it("rejects a request with missing required fields", async () => { const response = await request(app) .post("/subscriptions") .send({ customer_id: "cust_001" });

expect(response.status).toBe(400);
expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);


});

it("rejects an unknown plan without calling the provider", async () => { const response = await request(app) .post("/subscriptions") .send({ customer_id: "cust_001", plan: "enterprise", payment_method_id: "pm_test_visa_4242", });

expect(response.status).toBe(400);
expect(response.body.error).toBe("Unknown plan");
expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);


});

it("returns HTTP 404 for an unknown customer", async () => { const response = await request(app) .post("/subscriptions") .send({ customer_id: "cust_missing", plan: "pro", payment_method_id: "pm_test_visa_4242", });

expect(response.status).toBe(404);
expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);


}); });