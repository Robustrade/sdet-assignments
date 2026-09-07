import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SECRET = 'test_whsec_do_not_use_in_prod';

export function signPayload(rawBody: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string = WEBHOOK_SECRET,
): boolean {
  if (!signature) return false;
  const expected = signPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}
