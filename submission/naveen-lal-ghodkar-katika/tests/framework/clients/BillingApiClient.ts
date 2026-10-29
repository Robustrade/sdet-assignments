import request from 'supertest';
import type { Express } from 'express';

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export interface CreateOptions {
  /** Sent as the `Idempotency-Key` header; lets the caller safely retry a creation. */
  idempotencyKey?: string;
}

/**
 * Typed wrapper around Supertest. Specs call intent-named methods and never
 * deal with HTTP verbs, paths or headers directly.
 */
export class BillingApiClient {
  constructor(private readonly app: Express) {}

  async createSubscription(payload?: unknown, options: CreateOptions = {}): Promise<ApiResult> {
    let req = request(this.app).post('/subscriptions');
    if (options.idempotencyKey !== undefined) {
      req = req.set('Idempotency-Key', options.idempotencyKey);
    }
    const res = payload === undefined ? await req : await req.send(payload as object);
    return { status: res.status, body: res.body };
  }

  /** Sends an arbitrary raw body, used for malformed-JSON tests. */
  async createSubscriptionRaw(rawBody: string, contentType = 'application/json'): Promise<ApiResult> {
    const res = await request(this.app)
      .post('/subscriptions')
      .set('Content-Type', contentType)
      .send(rawBody);
    return { status: res.status, body: res.body };
  }

  async getSubscription(id: string): Promise<ApiResult> {
    const res = await request(this.app).get(`/subscriptions/${id}`);
    return { status: res.status, body: res.body };
  }

  async cancelSubscription(id: string): Promise<ApiResult> {
    const res = await request(this.app).post(`/subscriptions/${id}/cancel`);
    return { status: res.status, body: res.body };
  }

  /**
   * Posts exactly these bytes to the webhook endpoint. The string is sent as-is (never re-serialized),
   * because the signature is computed over the raw body. `signature` undefined means no header at all.
   */
  async postWebhook(rawBody: string, signature?: string): Promise<ApiResult> {
    let req = request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (signature !== undefined) {
      req = req.set('X-Provider-Signature', signature);
    }
    const res = await req.send(rawBody);
    return { status: res.status, body: res.body };
  }
}
