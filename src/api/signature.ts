import crypto from 'crypto';
import { WEBHOOK_SECRET } from '../utils/config';

/** Create an HMAC-SHA256 hex signature of the raw webhook body. */
export function createWebhookSignature(rawBody: string) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}
