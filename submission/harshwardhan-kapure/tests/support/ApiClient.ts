import { Express } from 'express';
import request from 'supertest';
import {
  ChargeOutcome,
  CreateSubscriptionRequest,
  InvoiceRecord,
  SubscriptionRecord,
  WebhookProcessingStatus
} from '../../src/types';
import { BuiltWebhookRequest } from './builders/WebhookBuilder';

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export interface BillingCycleResponse {
  subscription: SubscriptionRecord;
  invoice: InvoiceRecord;
  outcome: ChargeOutcome;
  error?: string;
}

export interface WebhookResponse {
  status: WebhookProcessingStatus;
  event_id: string;
  reason?: string;
}

/**
 * Typed HTTP client encapsulating Supertest transport details.
 */
export class ApiClient {
  constructor(private readonly app: Express) {}

  async createSubscription(
    payload: Partial<CreateSubscriptionRequest> | Record<string, unknown>,
    options?: { idempotencyKey?: string }
  ): Promise<ApiResponse<SubscriptionRecord & { error?: string; invoice?: InvoiceRecord }>> {
    const req = request(this.app).post('/subscriptions');
    if (options?.idempotencyKey) {
      req.set('Idempotency-Key', options.idempotencyKey);
    }
    const res = await req.send(payload);
    return { status: res.status, body: res.body };
  }

  async getSubscription(id: string): Promise<ApiResponse<SubscriptionRecord & { error?: string }>> {
    const res = await request(this.app).get(`/subscriptions/${id}`);
    return { status: res.status, body: res.body };
  }

  async cancelSubscription(id: string): Promise<ApiResponse<SubscriptionRecord & { error?: string }>> {
    const res = await request(this.app).post(`/subscriptions/${id}/cancel`).send();
    return { status: res.status, body: res.body };
  }

  async billSubscription(id: string): Promise<ApiResponse<BillingCycleResponse>> {
    const res = await request(this.app).post(`/subscriptions/${id}/bill`).send();
    return { status: res.status, body: res.body };
  }

  async sendWebhook(
    built: BuiltWebhookRequest
  ): Promise<ApiResponse<WebhookResponse & { error?: string }>> {
    const req = request(this.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json');

    for (const [key, value] of Object.entries(built.headers)) {
      req.set(key, value);
    }

    const res = await req.send(built.rawBody);
    return { status: res.status, body: res.body };
  }
}
