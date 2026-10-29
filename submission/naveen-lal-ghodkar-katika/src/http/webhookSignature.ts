import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_SHA256 = /^[0-9a-fA-F]{64}$/;

/**
 * Checks `X-Provider-Signature`: the hex HMAC-SHA256 of the exact bytes received, keyed with the
 * shared secret. The digests are compared in constant time. Anything that is not 64 hex characters
 * (missing, empty, duplicated header, wrong length) is simply invalid.
 */
export function isValidSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (header === undefined || !HEX_SHA256.test(header)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(header, 'hex'));
}
