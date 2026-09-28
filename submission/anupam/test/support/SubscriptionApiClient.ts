import request from 'supertest';
import type { Express } from 'express';
import type { SubscriptionDto } from '../../src/http/presenters';

export interface ApiError {
  error: { code: string; message: string; details: unknown };
}
export interface ApiResponse<T> {
  status: number;
  body: T;
}

/**
 * Typed API client: tests never see URLs, headers or supertest.
 * Swapping to a deployed environment = new client with a base URL (see docs).
 */
export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  async createSubscription(body: unknown): Promise<ApiResponse<SubscriptionDto & ApiError>> {
    const res = await request(this.app).post('/subscriptions').send(body as object);
    return { status: res.status, body: res.body };
  }

  async createSubscriptionRaw(raw: string): Promise<ApiResponse<ApiError>> {
    const res = await request(this.app)
      .post('/subscriptions')
      .set('Content-Type', 'application/json')
      .send(raw);
    return { status: res.status, body: res.body };
  }

  async getSubscription(id: string): Promise<ApiResponse<SubscriptionDto & ApiError>> {
    const res = await request(this.app).get(`/subscriptions/${id}`);
    return { status: res.status, body: res.body };
  }

  async cancelSubscription(id: string): Promise<ApiResponse<SubscriptionDto & ApiError>> {
    const res = await request(this.app).post(`/subscriptions/${id}/cancel`).send();
    return { status: res.status, body: res.body };
  }
}
