
import { createHmac, timingSafeEqual } from 'crypto';

export function generateWebhookSignature(
  payload: string,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = generateWebhookSignature(payload, secret);

  const receivedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
