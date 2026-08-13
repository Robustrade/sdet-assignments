import { signWebhook } from '../../src/webhookSignature.js';
import type { WebhookApiPayload } from '../builders/WebhookPayloadBuilder.js';

export type SignatureMode = 'valid' | 'missing' | 'wrong-secret';

export class WebhookSimulator {
  constructor(
    private readonly apiClient: { postWebhook(rawBody: string, signature: string | null): Promise<{ status: number; body: Record<string, unknown> }> },
    private readonly secret: string,
  ) {}

  async deliver(
    payload: WebhookApiPayload,
    mode: SignatureMode = 'valid',
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const rawBody = JSON.stringify(payload);
    let signature: string | null;
    if (mode === 'missing') {
      signature = null;
    } else if (mode === 'wrong-secret') {
      signature = signWebhook(rawBody, 'wrong-secret-not-the-real-one');
    } else {
      signature = signWebhook(rawBody, this.secret);
    }
    return this.apiClient.postWebhook(rawBody, signature);
  }

  async deliverRaw(
    rawBody: string,
    signature: string | null,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return this.apiClient.postWebhook(rawBody, signature);
  }
}