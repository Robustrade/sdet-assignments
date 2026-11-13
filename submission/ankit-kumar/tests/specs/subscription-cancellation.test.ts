import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app";
import { SubscriptionService } from "../../src/application/subscription-service";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { FakePaymentProvider } from "../support/fake-payment-provider";

describe("Subscription Cancellation API", () => {
  async function setup() {
    const database = await TestDatabase.create();

    const customers = new CustomerRepository(database);
    const subscriptions = new SubscriptionRepository(database);
    const provider = new FakePaymentProvider();

    customers.save({ id: "cust_001", name: "Ankit Kumar" });

    const service = new SubscriptionService({
      customerRepository: customers,
      subscriptionRepository: subscriptions,
      paymentProvider: provider
    });

    const app = createApp({
      subscriptionService: service,
      subscriptionRepository: subscriptions
    });

    return { database, app };
  }

  it("cancels an existing subscription", async () => {
    const { database, app } = await setup();

    try {
      const created = await request(app)
        .post("/subscriptions")
        .send({
          customer_id: "cust_001",
          plan: "basic",
          payment_method_id: "pm_test_visa_4242"
        })
        .expect(201);

      const canceled = await request(app)
        .post(`/subscriptions/${created.body.id}/cancel`)
        .expect(200);

      expect(canceled.body.status).toBe("canceled");

      const retrieved = await request(app)
        .get(`/subscriptions/${created.body.id}`)
        .expect(200);

      expect(retrieved.body.status).toBe("canceled");
    } finally {
      database.close();
    }
  });

  it("rejects cancellation of an already-canceled subscription", async () => {
    const { database, app } = await setup();

    try {
      const created = await request(app)
        .post("/subscriptions")
        .send({
          customer_id: "cust_001",
          plan: "basic",
          payment_method_id: "pm_test_visa_4242"
        })
        .expect(201);

      await request(app)
        .post(`/subscriptions/${created.body.id}/cancel`)
        .expect(200);

      await request(app)
        .post(`/subscriptions/${created.body.id}/cancel`)
        .expect(400);
    } finally {
      database.close();
    }
  });
});