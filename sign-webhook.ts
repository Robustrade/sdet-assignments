import { signWebhook } from './src/webhookSignature.js';

const b64 = process.argv[2] ?? '';
if (!b64) {
  console.error('usage: npx tsx sign-webhook.ts "<base64-encoded-webhook-body>"');
  console.error('       prints the HMAC-SHA256 signature for WEBHOOK_SIGNING_SECRET');
  process.exit(1);
}
const body = Buffer.from(b64, 'base64').toString('utf8');
process.stdout.write(signWebhook(body, 'dev-secret'));