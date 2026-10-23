import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SubscriptionBillingService, SubscriptionBillingDomainError } from './service.ts';
import type { PaymentWebhook } from './domain.ts';
export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
export function validSignature(body: string, supplied: string | undefined, secret: string): boolean {
  if (!supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(sign(body, secret), 'hex'), Buffer.from(supplied, 'hex'));
}
function parseWebhook(value: unknown): PaymentWebhook {
  if (!value || typeof value !== 'object') throw new SubscriptionBillingDomainError(400, 'Malformed webhook');
  const v = value as Record<string, unknown>;
  if (typeof v.event_id !== 'string' || !v.event_id ||
    !['payment.succeeded','payment.failed','payment.refunded'].includes(String(v.type)) ||
    typeof v.subscription_id !== 'string' || typeof v.invoice_id !== 'string' ||
    !Number.isSafeInteger(v.amount) || (v.amount as number) <= 0 || v.currency !== 'USD')
    throw new SubscriptionBillingDomainError(400, 'Malformed webhook');
  return v as unknown as PaymentWebhook;
}
async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk as Buffer); size += b.length;
    if (size > 65536) throw new SubscriptionBillingDomainError(413, 'Body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
}
export async function startBillingHttpFixture(service: SubscriptionBillingService, secret = 'local-test-secret') {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const match = /^\/subscriptions\/([^/]+)(?:\/(cancel|bill|retry-exhausted))?$/.exec(path);
      if (req.method === 'POST' && path === '/subscriptions') {
        const body = JSON.parse(await rawBody(req)); send(res, 201, service.createSubscription(body));
      } else if (match && req.method === 'GET' && !match[2]) {
        send(res, 200, service.getSubscriptionById(match[1]));
      } else if (match && req.method === 'POST' && match[2] === 'cancel') {
        send(res, 200, service.cancelSubscription(match[1]));
      } else if (match && req.method === 'POST' && match[2] === 'bill') {
        send(res, 200, await service.attemptSubscriptionCharge(match[1]));
      } else if (match && req.method === 'POST' && match[2] === 'retry-exhausted') {
        send(res, 200, service.markSubscriptionRetriesExhausted(match[1]));
      } else if (req.method === 'POST' && path === '/webhooks/payment-provider') {
        const raw = await rawBody(req);
        const signature = req.headers['x-provider-signature'];
        if (!validSignature(raw, typeof signature === 'string' ? signature : undefined, secret))
          throw new SubscriptionBillingDomainError(401, 'Invalid signature');
        let json: unknown;
        try { json = JSON.parse(raw); } catch { throw new SubscriptionBillingDomainError(400, 'Malformed JSON'); }
        send(res, 200, service.processPaymentWebhook(parseWebhook(json)));
      } else send(res, 404, { error: 'Not found' });
    } catch (error) {
      const e = error as Error;
      if (e instanceof SyntaxError) send(res, 400, { error: 'Malformed JSON' });
      else if (e instanceof SubscriptionBillingDomainError) send(res, e.statusCode, { error: e.message });
      else send(res, 500, { error: 'Internal error' });
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
