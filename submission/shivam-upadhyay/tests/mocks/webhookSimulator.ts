import type { Express } from 'express';
import request from 'supertest';
import { signWebhookPayload } from '../../src/webhookVerify';

export interface WebhookPayload {
  event_id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string;
  invoice_id?: string;
  amount: number;
  currency: string;
}

/**
 * Simulates the external payment provider delivering webhooks: builds signed,
 * unsigned, or malformed payloads and POSTs them to the fixture.
 */
export class WebhookSimulator {
  constructor(private readonly app: Express) {}

  async send(
    payload: WebhookPayload,
    opts: { signature?: 'valid' | 'invalid' | 'absent'; rawBody?: string } = {},
  ) {
    const raw = opts.rawBody ?? JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.signature !== 'absent') {
      headers['X-Provider-Signature'] =
        opts.signature === 'invalid' ? 'deadbeef' : signWebhookPayload(Buffer.from(raw));
    }
    return request(this.app).post('/webhooks/payment-provider').set(headers).send(raw);
  }
}
