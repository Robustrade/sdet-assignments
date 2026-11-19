import { Express } from 'express';
import request from 'supertest';
import { FieldError } from '../../../src/domain/errors';
import { SubscriptionResponse } from '../../../src/http/presenters';

export interface ErrorBody {
  error: { code: string; message: string; details?: FieldError[] };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export type SubscriptionApiResponse = ApiResponse<SubscriptionResponse & Partial<ErrorBody>>;
export type WebhookApiResponse = ApiResponse<{ status?: string; reason?: string } & Partial<ErrorBody>>;

/**
 * Typed HTTP client for the fixture. Tests call business-level methods; all
 * Supertest/transport details stay here.
 */
export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  async create(body: object, options: { idempotencyKey?: string } = {}): Promise<SubscriptionApiResponse> {
    let req = request(this.app).post('/subscriptions');
    if (options.idempotencyKey !== undefined) req = req.set('Idempotency-Key', options.idempotencyKey);
    return wrap(await req.send(body));
  }

  /** Sends a raw (possibly malformed) JSON string as the create body. */
  async createRaw(rawBody: string): Promise<SubscriptionApiResponse> {
    return wrap(await request(this.app).post('/subscriptions').set('Content-Type', 'application/json').send(rawBody));
  }

  async get(id: string): Promise<SubscriptionApiResponse> {
    return wrap(await request(this.app).get(`/subscriptions/${encodeURIComponent(id)}`));
  }

  async cancel(id: string): Promise<SubscriptionApiResponse> {
    return wrap(await request(this.app).post(`/subscriptions/${encodeURIComponent(id)}/cancel`));
  }

  async postWebhook(rawBody: string, signature?: string): Promise<WebhookApiResponse> {
    let req = request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (signature !== undefined) req = req.set('X-Provider-Signature', signature);
    return wrap(await req.send(rawBody));
  }
}

function wrap<T>(res: request.Response): ApiResponse<T> {
  return { status: res.status, body: res.body as T, headers: res.headers as Record<string, string> };
}
