import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `X-Provider-Signature` = hex(HMAC-SHA256(secret, rawBody))  (assumption A-10).
 * Always computed over the exact raw bytes, never over re-serialised JSON.
 */
export function computeSignature(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function isValidSignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeSignature(secret, rawBody), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  // timingSafeEqual requires equal lengths; comparing in constant time avoids leaking the digest.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
