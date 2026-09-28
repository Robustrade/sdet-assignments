import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { WebhookResponse } from '../../src/services/WebhookService';
import type { ApiError, ApiResponse } from './SubscriptionApiClient';

/**
 * Plays the role of the external payment provider SENDING webhooks.
 * Signs independently with node:crypto (does NOT reuse the production verifier),
 * so a bug in the verifier cannot make both sides agree by accident.
 */
export class WebhookSimulator {
  constructor(
    private readonly app: Express,
    private readonly secret: string,
  ) {}

  sign(raw: string, secret = this.secret): string {
    return createHmac('sha256', secret).update(raw).digest('hex');
  }

  /** Correctly signed delivery. */
  deliver(payload: object): Promise<ApiResponse<WebhookResponse & ApiError>> {
    const raw = JSON.stringify(payload);
    return this.post(raw, this.sign(raw));
  }

  /** Same event delivered N times (provider redelivery). */
  async deliverTimes(payload: object, times: number): Promise<ApiResponse<WebhookResponse & ApiError>[]> {
    const results = [];
    for (let i = 0; i < times; i++) results.push(await this.deliver(payload));
    return results;
  }

  deliverWithForgedSignature(payload: object) {
    const raw = JSON.stringify(payload);
    return this.post(raw, this.sign(raw, 'attacker-secret'));
  }

  deliverUnsigned(payload: object) {
    return this.post(JSON.stringify(payload), undefined);
  }

  /** Signature computed for `signed`, but `sent` is what goes over the wire (tampering). */
  deliverTampered(signed: object, sent: object) {
    return this.post(JSON.stringify(sent), this.sign(JSON.stringify(signed)));
  }

  /** Arbitrary raw body, correctly signed (for malformed-payload tests). */
  deliverRawSigned(raw: string) {
    return this.post(raw, this.sign(raw));
  }

  private async post(raw: string, signature: string | undefined): Promise<ApiResponse<WebhookResponse & ApiError>> {
    let req = request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (signature !== undefined) req = req.set('X-Provider-Signature', signature);
    const res = await req.send(raw);
    return { status: res.status, body: res.body };
  }
}
