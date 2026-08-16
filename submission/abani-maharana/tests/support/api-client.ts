import request, { type Response } from "supertest";

import type { Express } from "express";

export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  async createSubscription<T extends object>(payload: T): Promise<Response> {
    return request(this.app).post("/subscriptions").send(payload);
  }

  async getSubscription(subscriptionId: string): Promise<Response> {
    return request(this.app).get(`/subscriptions/${subscriptionId}`);
  }

  async cancelSubscription(subscriptionId: string): Promise<Response> {
    return request(this.app).post(`/subscriptions/${subscriptionId}/cancel`);
  }

  async sendWebhook<T extends object>(
    payload: T,
    signature?: string,
  ): Promise<Response> {
    const requestBuilder = request(this.app)
      .post("/webhooks/payment-provider")
      .send(payload);

    if (signature !== undefined) {
      requestBuilder.set("x-provider-signature", signature);
    }

    return requestBuilder;
  }
}

export default SubscriptionApiClient;
