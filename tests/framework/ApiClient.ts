import request from 'supertest';
import type { TestEnvironment } from './contracts.js';

function respond(res: request.Response): { status: number; body: Record<string, unknown> } {
  return { status: res.status, body: res.body as Record<string, unknown> };
}

export class ApiClient {
  constructor(private readonly env: TestEnvironment) {}

  async createSubscription(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(this.env.app).post('/subscriptions').send(body as object);
    return respond(res);
  }

  async getSubscription(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(this.env.app).get(`/subscriptions/${id}`);
    return respond(res);
  }

  async cancelSubscription(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(this.env.app).post(`/subscriptions/${id}/cancel`);
    return respond(res);
  }

  async postWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let req = request(this.env.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .send(rawBody);
    if (signature !== null) {
      req = req.set('X-Provider-Signature', signature);
    }
    const res = await req;
    return respond(res);
  }
}