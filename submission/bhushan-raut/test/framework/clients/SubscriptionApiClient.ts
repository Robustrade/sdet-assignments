import request from 'supertest';
type App = Parameters<typeof request>[0];
import type { ApiResponse, BillingRunResult, ErrorBody, SubscriptionView } from './contracts';

type Result<T> = Promise<ApiResponse<T & Partial<ErrorBody>>>;

export class SubscriptionApiClient {
  constructor(private readonly app: App) {}

  async create(body: unknown): Result<SubscriptionView> {
    return this.send(request(this.app).post('/subscriptions').send(body as object));
  }

  async get(id: string): Result<SubscriptionView> {
    return this.send(request(this.app).get(`/subscriptions/${id}`));
  }

  async cancel(id: string): Result<SubscriptionView> {
    return this.send(request(this.app).post(`/subscriptions/${id}/cancel`));
  }

  /** Stands in for the scheduler: run a billing attempt (trial end, renewal or retry) now. */
  async runBilling(subscriptionId: string): Result<BillingRunResult> {
    return this.send(request(this.app).post('/internal/billing/run').send({ subscription_id: subscriptionId }));
  }

  async createRaw(rawBody: string): Result<SubscriptionView> {
    return this.send(request(this.app).post('/subscriptions').set('Content-Type', 'application/json').send(rawBody));
  }

  private async send<T>(req: request.Test): Promise<ApiResponse<T>> {
    const res = await req;
    return { status: res.status, body: res.body as T };
  }
}
