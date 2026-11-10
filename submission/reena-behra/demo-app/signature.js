import { createHmac } from 'node:crypto';

// The payment gateway signs every webhook with a shared secret.
// We recompute the signature to make sure the webhook really came from the gateway.
export const WEBHOOK_SECRET = 'demo-webhook-secret';

export function signBody(rawBody) {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}
