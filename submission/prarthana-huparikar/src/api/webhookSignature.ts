import { createHmac } from 'crypto';

const SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret';

export function signPayload(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return signPayload(rawBody) === signature;
}
