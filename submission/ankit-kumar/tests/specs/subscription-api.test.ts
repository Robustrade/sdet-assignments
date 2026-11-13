import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app";
import { SubscriptionService } from "../../src/application/subscription-service";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { FakePaymentProvider } from "../support/fake-payment-provider";

describe("Subscription REST API", () => {
  async function setup() {
    const database = await TestDatabase.create();

    const customers = new CustomerRepository(database);
    const subscriptions = new SubscriptionRepository(database);
    const provider = new FakePaymentProvider();

    customers.save({
      id: "cust_001",
      name: "Ankit Kumar"
    });

    const service = new SubscriptionService({
      customerRepository: customers,
      subscriptionRepository: subscriptions,
      paymentProvider: provider,
      now: () => new Date("2026-11-13T10:00:00.000Z")
    });

    const app = createApp({
      subscriptionService: service,
      subscriptionRepository: subscriptions
    });

    return { database, app };
  }

  it("creates a subscription through POST API", async () => {
    const { database, app } = await setup();

    try {
      const response = await request(app)
        .post("/subscriptions")
        .send({
          customer_id: "cust_001",
          plan: "basic",
          payment_method_id: "pm_test_visa_4242"
        })
        .expect(201);

      expect(response.body.status).toBe("trialing");
      expect(response.body.customer_id).toBe("cust_001");
      expect(response.body.trial_ends_at)
        .toBe("2026-11-20T10:00:00.000Z");
    } finally {
      database.close();
    }
  });

  it("retrieves an existing subscription through GET API", async () => {
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

      const response = await request(app)
        .get(`/subscriptions/${created.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.status).toBe("trialing");
    } finally {
      database.close();
    }
  });

  it("returns 404 for an unknown subscription", async () => {
    const { database, app } = await setup();

    try {
      await request(app)
        .get("/subscriptions/sub_unknown")
        .expect(404);
    } finally {
      database.close();
    }
  });

  it("rejects an invalid creation request", async () => {
    const { database, app } = await setup();

    try {
      await request(app)
        .post("/subscriptions")
        .send({
          customer_id: "cust_001",
          plan: "unknown",
          payment_method_id: "pm_test_visa_4242"
        })
        .expect(400);
    } finally {
      database.close();
    }
  });
});