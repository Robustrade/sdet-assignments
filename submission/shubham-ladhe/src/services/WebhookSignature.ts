import { createHmac, timingSafeEqual } from 'crypto';

/** HMAC-SHA256 over the exact raw request bytes, hex encoded. */
export class WebhookSignature {
  constructor(private readonly secret: string) {}

  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  verify(rawBody: Buffer, signature: string): boolean {
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const given = Buffer.from(signature, 'hex');
    // Length check first: timingSafeEqual throws on unequal lengths.
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
