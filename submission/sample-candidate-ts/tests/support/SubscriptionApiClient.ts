import request, { Response } from "supertest";
import { Express } from "express";
import { HmacWebhookVerifier } from "../../src/webhooks/WebhookVerifier";
import { WebhookEventPayload } from "../../src/domain/types";

/**
 * API client layer (Adapter pattern): keeps transport details out of test
 * scenarios. Tests call `api.createSubscription(...)`, not
 * `request(app).post("/subscriptions").send(...)` — if the transport
 * changes, only this file needs to change.
 */
export class SubscriptionApiClient {
  private readonly verifier: HmacWebhookVerifier;

  constructor(
    private readonly app: Express,
    webhookSecret: string,
  ) {
    this.verifier = new HmacWebhookVerifier(webhookSecret);
  }

  createSubscription(payload: Record<string, unknown>): Promise<Response> {
    return request(this.app).post("/subscriptions").send(payload);
  }

  getSubscription(id: string): Promise<Response> {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancelSubscription(id: string): Promise<Response> {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }

  /** Sends a webhook with a correctly-signed body unless `signatureOverride` is given. */
  sendWebhook(payload: WebhookEventPayload, signatureOverride?: string | null): Promise<Response> {
    const rawBody = JSON.stringify(payload);
    const req = request(this.app).post("/webhooks/payment-provider").set("Content-Type", "application/json");

    if (signatureOverride === null) {
      return req.send(rawBody);
    }
    const signature = signatureOverride ?? this.verifier.sign(rawBody);
    return req.set("X-Provider-Signature", signature).send(rawBody);
  }
}
