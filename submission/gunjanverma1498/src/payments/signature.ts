import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature helpers.
 *
 * The provider signs the raw request body with a shared secret (HMAC-SHA256) and
 * sends the hex digest in `X-Provider-Signature`. The service recomputes the
 * digest over the exact received bytes and compares in constant time. The test
 * suite uses {@link signPayload} to forge valid signatures and deliberately
 * omits/tampers with them to exercise the rejection path.
 */

export const SIGNATURE_HEADER = 'x-provider-signature';

export function signPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = signPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
