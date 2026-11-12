import type { Express } from 'express';
import request from 'supertest';

// Response shapes of the service, so tests are type-checked instead of poking at `any`.
export interface ErrorBody {
  error?: { code: string; message: string };
}

export interface SubscriptionBody extends ErrorBody {
  id: string;
  customer_id: string;
  plan: string;
  status: string;
  price: number;
  currency: string;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingBody extends ErrorBody {
  subscription: SubscriptionBody;
  invoice: { id: string; status: string; amount: number };
}

export interface WebhookBody extends ErrorBody {
  status?: string;
  outcome?: string;
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/**
 * Typed client over the service's HTTP API (supertest drives the Express app in-process).
 * Keeps URLs, headers and JSON handling out of the tests.
 */
export class SubscriptionApiClient {
  private readonly app: Express;

  constructor(app: Express) {
    this.app = app;
  }

  async createSubscription(body: object): Promise<ApiResponse<SubscriptionBody>> {
    const res = await request(this.app).post('/subscriptions').send(body);
    return { status: res.status, body: res.body };
  }

  async getSubscription(id: string): Promise<ApiResponse<SubscriptionBody>> {
    const res = await request(this.app).get(`/subscriptions/${id}`);
    return { status: res.status, body: res.body };
  }

  async cancelSubscription(id: string): Promise<ApiResponse<SubscriptionBody>> {
    const res = await request(this.app).post(`/subscriptions/${id}/cancel`);
    return { status: res.status, body: res.body };
  }

  /** Test hook on the fixture: runs one billing attempt (trial end / renewal / retry). */
  async billSubscription(id: string): Promise<ApiResponse<BillingBody>> {
    const res = await request(this.app).post(`/internal/subscriptions/${id}/bill`);
    return { status: res.status, body: res.body };
  }

  /** Sends the body exactly as given (no JSON serialisation), e.g. malformed JSON. */
  async postRaw(path: string, rawBody: string, headers: Record<string, string> = {}): Promise<ApiResponse<WebhookBody>> {
    const res = await request(this.app).post(path).set('Content-Type', 'application/json').set(headers).send(rawBody);
    return { status: res.status, body: res.body };
  }
}
