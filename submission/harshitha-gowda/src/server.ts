import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError, type BillingService } from './billing-service.ts';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function validSignature(secret: string, raw: string, header: string | string[] | undefined): boolean {
  if (typeof header !== 'string') return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(service: BillingService, webhookSecret: string): Server {
  return createServer(async (req, res) => {
    try {
      const url = (req.url ?? '').split('?')[0];
      const method = req.method ?? 'GET';
      const raw = method === 'POST' ? await readBody(req) : '';

      const parseJson = () => {
        try {
          return raw === '' ? {} : JSON.parse(raw);
        } catch {
          throw new ApiError(400, 'invalid_json');
        }
      };

      if (method === 'POST' && url === '/subscriptions') {
        return send(res, 201, await service.createSubscription(parseJson()));
      }
      if (method === 'POST' && url === '/webhooks/payment-provider') {
        if (!validSignature(webhookSecret, raw, req.headers['x-provider-signature'])) {
          throw new ApiError(401, 'invalid_signature');
        }
        return send(res, 200, service.handleWebhook(parseJson()));
      }

      let m = url.match(/^\/subscriptions\/([^/]+)$/);
      if (m && method === 'GET') return send(res, 200, service.getSubscription(m[1]));

      m = url.match(/^\/subscriptions\/([^/]+)\/cancel$/);
      if (m && method === 'POST') return send(res, 200, service.cancel(m[1]));

      m = url.match(/^\/admin\/subscriptions\/([^/]+)\/trial-end$/);
      if (m && method === 'POST') return send(res, 200, await service.advanceTrial(m[1]));

      m = url.match(/^\/admin\/subscriptions\/([^/]+)\/retry$/);
      if (m && method === 'POST') return send(res, 200, await service.retryCharge(m[1]));

      throw new ApiError(404, 'not_found');
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      console.error(err);
      send(res, 500, { error: { code: 'internal_error' } });
    }
  });
}
