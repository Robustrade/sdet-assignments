
import request from "supertest";
import { createApp } from "../../src/app";

describe("Subscription API", () => {
  const app = createApp();

  test("POST creates a subscription", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({
        customerId: "cust_001",
        planId: "plan_basic"
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.status).toBe("trialing");
  });

  test("POST rejects missing customer ID", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({ planId: "plan_basic" });

    expect(response.status).toBe(400);
  });

  test("GET retrieves a created subscription", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({
        customerId: "cust_002",
        planId: "plan_premium"
      });

    const response = await request(app)
      .get(`/subscriptions/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.customerId).toBe("cust_002");
  });

  test("GET returns 404 for unknown subscription", async () => {
    const response = await request(app)
      .get("/subscriptions/unknown");

    expect(response.status).toBe(404);
  });
});
