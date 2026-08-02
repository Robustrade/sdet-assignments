import crypto from 'crypto';

export const WEBHOOK_SECRET = 'test_webhook_secret';

export function createWebhookSignature(rawBody: string) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}
