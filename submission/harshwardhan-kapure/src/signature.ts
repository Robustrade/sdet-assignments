import crypto from 'node:crypto';

export const DEFAULT_WEBHOOK_SECRET = 'kulu_sdet_webhook_secret';

/**
 * Computes the hex HMAC-SHA256 signature for a raw webhook payload.
 */
export function signWebhookPayload(rawBody: string | Buffer, secret: string = DEFAULT_WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Performs timing-safe HMAC-SHA256 verification against raw request bytes.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string = DEFAULT_WEBHOOK_SECRET
): boolean {
  if (!signature || typeof signature !== 'string') {
    return false;
  }
  const expectedHex = signWebhookPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const providedBuf = Buffer.from(signature.trim(), 'utf8');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
