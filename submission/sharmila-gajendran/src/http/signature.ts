import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX = /^[0-9a-f]+$/i;

export function signPayload(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** HMAC-SHA256 of the exact raw bytes, compared in constant time. */
export function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !HEX.test(signature)) {
    return false;
  }
  const expected = Buffer.from(signPayload(rawBody, secret), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
