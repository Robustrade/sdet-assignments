import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 over the RAW request body, hex encoded. */
export class WebhookSignatureVerifier {
  constructor(private readonly secret: string) {}

  isValid(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
