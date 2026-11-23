import type { Express } from 'express';
import request from 'supertest';

/** Typed client for the subscription API; transport stays out of test logic. */
export class ApiClient {
  constructor(private readonly app: Express) {}

  create(body: Record<string, unknown>) {
    return request(this.app).post('/subscriptions').send(body);
  }

  get(id: string) {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancel(id: string) {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }
}
