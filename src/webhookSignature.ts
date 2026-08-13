import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(body: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyWebhook(
  body: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(body, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}