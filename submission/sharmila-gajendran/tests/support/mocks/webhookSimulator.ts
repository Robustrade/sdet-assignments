import { createHmac } from 'node:crypto';
import type { WebhookPayload } from '../builders/webhookEventBuilder';
import type { ApiResult, SubscriptionApiClient, WebhookAck } from '../clients/subscriptionApiClient';

/**
 * Plays the payment provider's side of webhooks. It signs payloads with the shared secret using
 * its own HMAC code (not the service's), and can send them signed, unsigned, wrongly signed or tampered.
 */
export class WebhookSimulator {
  constructor(
    private readonly api: SubscriptionApiClient,
    private readonly secret: string,
  ) {}

  sign(rawBody: string, secret: string = this.secret): string {
    return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  }

  /** A genuine delivery: correct body, correct signature. */
  deliver(payload: WebhookPayload): Promise<ApiResult<WebhookAck>> {
    const rawBody = JSON.stringify(payload);
    return this.api.postWebhook(rawBody, this.sign(rawBody));
  }

  deliverWithSignature(payload: WebhookPayload, signature: string): Promise<ApiResult<WebhookAck>> {
    return this.api.postWebhook(JSON.stringify(payload), signature);
  }

  deliverSignedWith(payload: WebhookPayload, otherSecret: string): Promise<ApiResult<WebhookAck>> {
    const rawBody = JSON.stringify(payload);
    return this.api.postWebhook(rawBody, this.sign(rawBody, otherSecret));
  }

  deliverWithoutSignature(payload: WebhookPayload): Promise<ApiResult<WebhookAck>> {
    return this.api.postWebhook(JSON.stringify(payload), undefined);
  }

  /** Signs the original payload, then sends a changed one with that signature. */
  deliverTampered(payload: WebhookPayload, change: (original: WebhookPayload) => WebhookPayload): Promise<ApiResult<WebhookAck>> {
    const signature = this.sign(JSON.stringify(payload));
    return this.api.postWebhook(JSON.stringify(change({ ...payload })), signature);
  }

  /** Correctly signs and sends any raw text, e.g. malformed JSON. */
  deliverRaw(rawBody: string): Promise<ApiResult<WebhookAck>> {
    return this.api.postWebhook(rawBody, this.sign(rawBody));
  }
}
