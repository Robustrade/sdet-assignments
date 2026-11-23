import request from "supertest";
import { createHmac } from "crypto";
import type { Express } from "express";

export class ApiClient {
  constructor(private app: Express, private webhookSecret = "test-webhook-secret") {}

  create(body: Record<string, unknown>) {
    return request(this.app).post("/subscriptions").send(body);
  }

  get(id: string) {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancel(id: string) {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }

  webhook(payload: Record<string, unknown>, options?: { signed?: boolean; signature?: string }) {
    const raw = JSON.stringify(payload);
    const signed = options?.signed !== false;
    const signature = options?.signature ??
      createHmac("sha256", this.webhookSecret).update(raw).digest("hex");
    let call = request(this.app).post("/webhooks/payment-provider");
    if (signed) call = call.set("X-Provider-Signature", signature);
    return call.send(payload);
  }
}
