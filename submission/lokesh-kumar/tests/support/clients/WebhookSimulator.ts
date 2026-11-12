import { createHmac } from 'node:crypto';
import type { ApiResponse, SubscriptionApiClient, WebhookBody } from './ApiClient.js';

const WEBHOOK_PATH = '/webhooks/payment-provider';
const SIGNATURE_HEADER = 'X-Provider-Signature';

/**
 * Plays the role of the payment provider calling the service back. It signs payloads with
 * its OWN implementation of the HMAC (not the service's), so a signing bug in the service
 * cannot hide itself.
 */
export class WebhookSimulator {
  private readonly api: SubscriptionApiClient;
  private readonly secret: string;

  constructor(api: SubscriptionApiClient, secret: string) {
    this.api = api;
    this.secret = secret;
  }

  sign(rawBody: string, secret: string = this.secret): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  /** A correctly signed delivery. */
  deliver(payload: object): Promise<ApiResponse<WebhookBody>> {
    return this.deliverRaw(JSON.stringify(payload));
  }

  /** Signed correctly over arbitrary bytes, e.g. a body that is not JSON. */
  deliverRaw(rawBody: string): Promise<ApiResponse<WebhookBody>> {
    return this.api.postRaw(WEBHOOK_PATH, rawBody, { [SIGNATURE_HEADER]: this.sign(rawBody) });
  }

  deliverUnsigned(payload: object): Promise<ApiResponse<WebhookBody>> {
    return this.api.postRaw(WEBHOOK_PATH, JSON.stringify(payload));
  }

  /** Signed with the wrong secret, as a forger would. */
  deliverForged(payload: object): Promise<ApiResponse<WebhookBody>> {
    const raw = JSON.stringify(payload);
    return this.api.postRaw(WEBHOOK_PATH, raw, { [SIGNATURE_HEADER]: this.sign(raw, 'not-the-real-secret') });
  }

  /** Valid signature, but the body was changed after signing. */
  deliverTampered(payload: object, tamper: (raw: string) => string): Promise<ApiResponse<WebhookBody>> {
    const raw = JSON.stringify(payload);
    return this.api.postRaw(WEBHOOK_PATH, tamper(raw), { [SIGNATURE_HEADER]: this.sign(raw) });
  }
}
