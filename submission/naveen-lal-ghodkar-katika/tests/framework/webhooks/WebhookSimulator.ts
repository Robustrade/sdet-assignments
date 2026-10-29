import { createHmac } from 'node:crypto';
import type { ApiResult, BillingApiClient } from '../clients/BillingApiClient';

/** A request as it will go on the wire: exact body bytes plus the signature header (if any). */
export interface WebhookDelivery {
  readonly rawBody: string;
  readonly signature?: string;
}

/**
 * Plays the payment provider's webhook sender. It computes HMAC-SHA256 itself (it does not reuse the
 * service's verifier), so a bug in the service's verification cannot make these tests agree with it.
 *
 * `signed` is the only honest delivery; every other method is a deliberate fault.
 */
export class WebhookSimulator {
  constructor(
    private readonly api: BillingApiClient,
    private readonly secret: string,
  ) {}

  sign(rawBody: string, secret: string = this.secret): string {
    return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  }

  /** Valid: body signed with the shared secret. */
  signed(event: unknown): WebhookDelivery {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: this.sign(rawBody) };
  }

  /** A validly signed body that is not valid JSON (the signature is fine, the payload is not). */
  signedRaw(rawBody: string): WebhookDelivery {
    return { rawBody, signature: this.sign(rawBody) };
  }

  /** No `X-Provider-Signature` header at all. */
  unsigned(event: unknown): WebhookDelivery {
    return { rawBody: JSON.stringify(event) };
  }

  /** Signed by someone who does not know the shared secret (a forgery). */
  signedWithWrongSecret(event: unknown): WebhookDelivery {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: this.sign(rawBody, 'whsec_attacker_guess') };
  }

  /** Signed for `event`, then the body is altered in transit (here: a different amount). */
  tamperedAfterSigning(event: Record<string, unknown>): WebhookDelivery {
    const signature = this.sign(JSON.stringify(event));
    return { rawBody: JSON.stringify({ ...event, amount: 1 }), signature };
  }

  /** A header value that is not a signature at all. */
  withSignatureHeader(event: unknown, signature: string): WebhookDelivery {
    return { rawBody: JSON.stringify(event), signature };
  }

  send(delivery: WebhookDelivery): Promise<ApiResult> {
    return this.api.postWebhook(delivery.rawBody, delivery.signature);
  }

  /** Shortcut for the common case: sign `event` correctly and deliver it. */
  deliver(event: unknown): Promise<ApiResult> {
    return this.send(this.signed(event));
  }
}
