/**
 * Typed HTTP client encapsulating Subscription & Billing API calls over supertest.
 * Author: Vedant Dalkari
 */

import type { Express } from 'express';
import request from 'supertest';
import type {
  ApiResponse,
  CreateSubscriptionPayload,
  RunDueResponseBody,
  SubscriptionSnapshot,
} from './contracts.js';

export class BillingApiClient {
  private readonly app: Express;

  public constructor(app: Express) {
    this.app = app;
  }

  public async createSubscription(
    payload: CreateSubscriptionPayload | Record<string, unknown>,
  ): Promise<ApiResponse<SubscriptionSnapshot>> {
    const res = await request(this.app)
      .post('/subscriptions')
      .set('content-type', 'application/json')
      .send(payload);
    return {
      status: res.status,
      body: res.body as unknown as SubscriptionSnapshot,
      rawBody: res.text,
    };
  }

  public async createSubscriptionRaw(
    rawJson: string,
  ): Promise<ApiResponse<SubscriptionSnapshot>> {
    const res = await request(this.app)
      .post('/subscriptions')
      .set('content-type', 'application/json')
      .send(rawJson);
    return {
      status: res.status,
      body: res.body as unknown as SubscriptionSnapshot,
      rawBody: res.text,
    };
  }

  public async getSubscription(subscriptionId: string): Promise<ApiResponse<SubscriptionSnapshot>> {
    const res = await request(this.app).get(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    return {
      status: res.status,
      body: res.body as unknown as SubscriptionSnapshot,
      rawBody: res.text,
    };
  }

  public async cancelSubscription(subscriptionId: string): Promise<ApiResponse<SubscriptionSnapshot>> {
    const res = await request(this.app)
      .post(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`)
      .send({});
    return {
      status: res.status,
      body: res.body as unknown as SubscriptionSnapshot,
      rawBody: res.text,
    };
  }

  public async runDueBilling(): Promise<ApiResponse<RunDueResponseBody>> {
    const res = await request(this.app).post('/billing/run-due').send({});
    return {
      status: res.status,
      body: res.body as unknown as RunDueResponseBody,
      rawBody: res.text,
    };
  }
}
