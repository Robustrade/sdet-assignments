import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from './domain.ts';
import { BillingService } from './service.ts';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw new DomainError(413, 'Request body too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
}
export function createApp(service: BillingService, webhookSecret: string) {
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://fixture.local').pathname;
      const raw = await readBody(req);
      if (req.method === 'POST' && path === '/webhooks/payment-provider') {
        const signature = req.headers['x-provider-signature'];
        const expected = createHmac('sha256', webhookSecret).update(raw).digest();
        if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) ||
            !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
          throw new DomainError(401, 'Invalid provider signature');
        }
        json(res, 200, service.webhook(raw)); return;
      }
      let data: unknown;
      if (raw.length) {
        try { data = JSON.parse(raw.toString('utf8')); }
        catch { throw new DomainError(400, 'Malformed JSON'); }
      }
      if (req.method === 'POST' && path === '/subscriptions') {
        const {pending, ...result} = await service.create(data);
        json(res, pending ? 202 : 201, result); return;
      }
      const match = /^\/subscriptions\/([^/]+)(?:\/(cancel|plan|bill))?$/.exec(path);
      if (match) {
        const id = match[1]!;
        const action = match[2];
        if (req.method === 'GET' && !action) { json(res, 200, service.get(id)); return; }
        if (req.method === 'POST') {
          if (action === 'cancel') { json(res, 200, service.cancel(id)); return; }
          if (action === 'plan') { json(res, 200, service.changePlan(id, data)); return; }
          if (action === 'bill') {
            const {pending, ...result} = await service.bill(id);
            json(res, pending ? 202 : 200, result); return;
          }
        }
      }
      throw new DomainError(404, 'Route not found');
    } catch (error) {
      json(res, error instanceof DomainError ? error.status : 500,
        {error: error instanceof DomainError ? error.message : 'Internal server error'});
    }
  });
}
