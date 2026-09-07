import request from 'supertest';
import { Express } from 'express';

export interface CreateSubscriptionRequestBody {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}


export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  createSubscription(body: CreateSubscriptionRequestBody) {
    return request(this.app).post('/subscriptions').send(body);
  }

  getSubscription(id: string) {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancelSubscription(id: string) {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }

  postRawSubscriptionBody(rawBody: string) {
    return request(this.app).post('/subscriptions').set('Content-Type', 'application/json').send(rawBody);
  }

  postWebhook(rawBody: string, signature?: string) {
    const req = request(this.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json');
    if (signature !== undefined) req.set('X-Provider-Signature', signature);
    return req.send(rawBody);
  }
}
