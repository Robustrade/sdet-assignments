import request, { type Response } from "supertest";
import type { Express } from "express";

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: "basic" | "pro";
  payment_method_id: string;
}

export interface SubscriptionResponse {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  status: string;
  created_at: string;
  canceled_at?: string | null;
}

export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  createSubscription(
    payload: CreateSubscriptionRequest,
  ): Promise<Response> {
    return request(this.app)
      .post("/subscriptions")
      .send(payload);
  }

  getSubscription(subscriptionId: string): Promise<Response> {
    return request(this.app)
      .get(`/subscriptions/${subscriptionId}`);
  }

  cancelSubscription(subscriptionId: string): Promise<Response> {
    return request(this.app)
      .post(`/subscriptions/${subscriptionId}/cancel`);
  }

  sendWebhook(
    payload: object,
    signature: string,
  ): Promise<Response> {
    return request(this.app)
      .post("/webhooks/payment-provider")
      .set("X-Provider-Signature", signature)
      .send(payload);
  }
}