import { createHmac } from 'node:crypto';

/** What goes on the wire: the exact raw body, plus the signature header if any. */
export interface WebhookDelivery {
  readonly rawBody: string;
  readonly signature?: string;
}

/**
 * Plays the payment provider's webhook sender. Signs with its own HMAC code rather
 * than importing the service's signer, so a bug in the service's signature scheme
 * cannot be mirrored by the tests.
 */
export class WebhookSimulator {
  constructor(private readonly secret: string) {}

  signed(payload: object): WebhookDelivery {
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: this.hmac(rawBody, this.secret) };
  }

  unsigned(payload: object): WebhookDelivery {
    return { rawBody: JSON.stringify(payload) };
  }

  signedWithWrongSecret(payload: object): WebhookDelivery {
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: this.hmac(rawBody, 'whsec_attacker') };
  }

  /** Signature is valid for the original body; the body is changed afterwards (e.g. amount inflated in transit). */
  tamperedAfterSigning(payload: object, tamper: (p: Record<string, unknown>) => void): WebhookDelivery {
    const { signature } = this.signed(payload);
    const altered = structuredClone(payload) as Record<string, unknown>;
    tamper(altered);
    return { rawBody: JSON.stringify(altered), signature: signature! };
  }

  /** Correctly signed, so it gets past authentication and exercises the parser. */
  signedRaw(rawBody: string): WebhookDelivery {
    return { rawBody, signature: this.hmac(rawBody, this.secret) };
  }

  private hmac(rawBody: string, secret: string): string {
    return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  }
}
