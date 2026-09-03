import request, { Response, Test } from "supertest";
import { createApp } from "../../src/api/app";

export class SubscriptionApiClient {
  constructor(
    private readonly server: ReturnType<typeof createApp>
  ) {}

  // Low-level HTTP methods.
  // These keep existing tests compatible with Supertest-style calls.
  post(path: string): Test {
    return request(this.server.app).post(path);
  }

  get(path: string): Test {
    return request(this.server.app).get(path);
  }

  // High-level API methods for cleaner future test scenarios.
  async createSubscription(
    customerId: string,
    planId: string
  ): Promise<Response> {
    return request(this.server.app)
      .post("/subscriptions")
      .send({
        customerId,
        planId,
      });
  }

  async getSubscription(
    subscriptionId: string
  ): Promise<Response> {
    return request(this.server.app).get(
      `/subscriptions/${subscriptionId}`
    );
  }

  async cancelSubscription(
    subscriptionId: string
  ): Promise<Response> {
    return request(this.server.app).post(
      `/subscriptions/${subscriptionId}/cancel`
    );
  }

  async pay(
    subscriptionId: string
  ): Promise<Response> {
    return request(this.server.app).post(
      `/subscriptions/${subscriptionId}/pay`
    );
  }

  async sendWebhook(
    payload: object,
    signature: string
  ): Promise<Response> {
    return request(this.server.app)
      .post("/webhooks/payment-provider")
      .set("X-Provider-Signature", signature)
      .send(payload);
  }
}