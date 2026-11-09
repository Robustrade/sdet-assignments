import supertest from 'supertest';
import type { Express } from 'express';
import { SIGNATURE_HEADER } from '../../../src/payments/signature';
import type { SignedWebhook } from '../builders/WebhookEventBuilder';
import type { SubscriptionRequestBody } from '../builders/SubscriptionRequestBuilder';

/**
 * Typed HTTP client over the service.
 *
 * Keeps transport details (routes, headers, raw-body handling for signed
 * webhooks) out of the test bodies. Tests express intent — "create this
 * subscription", "post this signed webhook" — and get back the parsed response.
 */
export class BillingApiClient {
  constructor(private readonly app: Express) {}

  createSubscription(body: SubscriptionRequestBody) {
    return supertest(this.app).post('/subscriptions').send(body);
  }

  getSubscription(id: string) {
    return supertest(this.app).get(`/subscriptions/${id}`);
  }

  cancelSubscription(id: string) {
    return supertest(this.app).post(`/subscriptions/${id}/cancel`).send({});
  }

  /** Posts a webhook built by {@link WebhookEventBuilder}, preserving raw bytes. */
  postWebhook(event: SignedWebhook) {
    const req = supertest(this.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json');
    if (event.signature !== undefined) {
      req.set(SIGNATURE_HEADER, event.signature);
    }
    return req.send(event.rawBody);
  }
}
