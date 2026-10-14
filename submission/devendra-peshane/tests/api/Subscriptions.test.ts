import request from "supertest";
import { createApp } from "../../src/app";

describe("Subscription API", () => {
  const app = createApp();

  test("creates a Basic subscription", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_test_001", plan: "basic" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      customerId: "cus_test_001",
      plan: "basic",
      status: "trialing",
      amount: 1000,
      trialDays: 7,
    });
    expect(response.body.data.id).toBeDefined();
  });

  test("rejects an unknown plan", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_test_001", plan: "premium" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unknown plan");
  });

  test("rejects an unknown customer", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_unknown", plan: "basic" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unknown customer");
  });

  test("rejects a missing customer ID", async () => {
    const response = await request(app)
      .post("/subscriptions")
      .send({ plan: "basic" });

    expect(response.status).toBe(400);
  });

  test("retrieves a created subscription", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_test_001", plan: "pro" });

    const response = await request(app)
      .get(`/subscriptions/${created.body.data.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.plan).toBe("pro");
    expect(response.body.data.trialDays).toBe(14);
  });

  test("returns 404 for an unknown subscription", async () => {
    const response = await request(app).get("/subscriptions/missing");

    expect(response.status).toBe(404);
  });

  test("cancels an existing subscription", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_test_001", plan: "basic" });

    const response = await request(app)
      .post(`/subscriptions/${created.body.data.id}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("canceled");
  });

  test("does not allow a canceled subscription to be canceled again", async () => {
    const created = await request(app)
      .post("/subscriptions")
      .send({ customerId: "cus_test_001", plan: "basic" });

    const id = created.body.data.id;

    await request(app).post(`/subscriptions/${id}/cancel`);
    const response = await request(app).post(`/subscriptions/${id}/cancel`);

    expect(response.status).toBe(409);
  });
});
