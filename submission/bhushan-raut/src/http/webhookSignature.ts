import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 over the exact raw bytes received — never over re-serialised JSON. */
export function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
