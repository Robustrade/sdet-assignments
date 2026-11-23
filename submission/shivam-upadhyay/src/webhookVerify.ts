import { createHmac, timingSafeEqual } from 'node:crypto';

/** Test-only secret. Real deployments must inject this from the environment. */
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test_secret';

export function signWebhookPayload(rawBody: Buffer, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Timing-safe HMAC check. Missing or malformed signatures fail closed. */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string = WEBHOOK_SECRET,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhookPayload(rawBody, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
