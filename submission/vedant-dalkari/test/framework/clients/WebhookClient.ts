/**
 * Typed HTTP client for sending raw signed/unsigned webhooks to /webhooks/payment-provider.
 * Author: Vedant Dalkari
 */

import type { Express } from 'express';
import request from 'supertest';
import type { BuiltWebhookRequest } from '../builders/SignedWebhookBuilder.js';
import type { ApiResponse, WebhookResponseBody } from './contracts.js';

export class WebhookClient {
  private readonly app: Express;

  public constructor(app: Express) {
    this.app = app;
  }

  public async sendSigned(
    built: BuiltWebhookRequest,
  ): Promise<ApiResponse<WebhookResponseBody>> {
    return this.sendRaw(built.rawBody, built.headers);
  }

  public async sendRaw(
    rawBody: string,
    headers: Record<string, string> = { 'content-type': 'application/json' },
  ): Promise<ApiResponse<WebhookResponseBody>> {
    const req = request(this.app).post('/webhooks/payment-provider');
    for (const [key, value] of Object.entries(headers)) {
      req.set(key, value);
    }
    const res = await req.send(rawBody);
    return {
      status: res.status,
      body: res.body as unknown as WebhookResponseBody,
      rawBody: res.text,
    };
  }
}
