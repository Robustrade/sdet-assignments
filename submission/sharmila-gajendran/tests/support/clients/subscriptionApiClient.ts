import type { Express } from 'express';
import request from 'supertest';
import type { SubscriptionDto } from '../../../src/http/subscriptionDto';

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export interface WebhookAck {
  readonly event_id: string;
  readonly outcome: string;
}

export interface BillingRunResult {
  readonly attempted: number;
}

/** A response from the service: `data()` for the typed success body, `errorCode()` for errors. */
export class ApiResult<T> {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}

  data(): T {
    return this.body as T;
  }

  errorCode(): string | undefined {
    return (this.body as Partial<ErrorBody> | undefined)?.error?.code;
  }
}

/**
 * Typed client for the service. Specs call these methods and never build HTTP requests
 * themselves, so a change in transport touches only this file.
 */
export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  async createSubscription(body: Record<string, unknown>): Promise<ApiResult<SubscriptionDto>> {
    const res = await request(this.app).post('/subscriptions').send(body);
    return new ApiResult(res.status, res.body);
  }

  /** Sends the body exactly as given, for malformed-JSON checks. */
  async createSubscriptionRaw(rawBody: string): Promise<ApiResult<SubscriptionDto>> {
    const res = await request(this.app).post('/subscriptions').set('Content-Type', 'application/json').send(rawBody);
    return new ApiResult(res.status, res.body);
  }

  async getSubscription(id: string): Promise<ApiResult<SubscriptionDto>> {
    const res = await request(this.app).get(`/subscriptions/${encodeURIComponent(id)}`);
    return new ApiResult(res.status, res.body);
  }

  async cancelSubscription(id: string): Promise<ApiResult<SubscriptionDto>> {
    const res = await request(this.app).post(`/subscriptions/${encodeURIComponent(id)}/cancel`);
    return new ApiResult(res.status, res.body);
  }

  async runBilling(): Promise<ApiResult<BillingRunResult>> {
    const res = await request(this.app).post('/internal/billing/run');
    return new ApiResult(res.status, res.body);
  }

  async postWebhook(rawBody: string, signature: string | undefined): Promise<ApiResult<WebhookAck>> {
    let call = request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (signature !== undefined) {
      call = call.set('X-Provider-Signature', signature);
    }
    const res = await call.send(rawBody);
    return new ApiResult(res.status, res.body);
  }
}
