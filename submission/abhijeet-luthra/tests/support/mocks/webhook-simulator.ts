import { computeSignature } from '../../../src/webhooks/signature';
import { SubscriptionApiClient, WebhookApiResponse } from '../clients/subscription-api-client';

export type SignatureMode = 'valid' | 'wrong-secret' | 'missing' | 'tampered-body';

/**
 * Plays the role of the payment provider sending webhooks: signs the raw body
 * with the shared secret, or deliberately breaks the signature.
 */
export class WebhookSimulator {
  constructor(
    private readonly api: SubscriptionApiClient,
    private readonly secret: string,
  ) {}

  deliver(payload: Record<string, unknown>, mode: SignatureMode = 'valid'): Promise<WebhookApiResponse> {
    const raw = JSON.stringify(payload);
    switch (mode) {
      case 'valid':
        return this.api.postWebhook(raw, computeSignature(this.secret, raw));
      case 'wrong-secret':
        return this.api.postWebhook(raw, computeSignature('not-the-shared-secret', raw));
      case 'missing':
        return this.api.postWebhook(raw);
      case 'tampered-body': {
        // Signed correctly, then modified in transit (amount changed).
        const tampered = JSON.stringify({ ...payload, amount: Number(payload.amount ?? 0) + 1 });
        return this.api.postWebhook(tampered, computeSignature(this.secret, raw));
      }
    }
  }

  /** Signs and sends an arbitrary raw string (e.g. malformed JSON with a valid signature). */
  deliverRaw(raw: string): Promise<WebhookApiResponse> {
    return this.api.postWebhook(raw, computeSignature(this.secret, raw));
  }
}
