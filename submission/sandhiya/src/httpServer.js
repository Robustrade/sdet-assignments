import http from 'node:http';
import crypto from 'node:crypto';

export function createHttpServer({ service, webhookSecret = 'test-secret' }) {
  return http.createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const url = new URL(request.url, 'http://127.0.0.1');
      if (method === 'POST' && url.pathname === '/subscriptions') {
        const subscription = await service.createSubscription(await readBody(request));
        return sendJson(response, 201, subscription);
      }
      const getMatch = url.pathname.match(/^\/subscriptions\/([^/]+)$/);
      if (method === 'GET' && getMatch) {
        const subscription = service.getSubscription(decodeURIComponent(getMatch[1]));
        return subscription ? sendJson(response, 200, subscription) : sendJson(response, 404, { error: 'Subscription not found' });
      }
      const cancelMatch = url.pathname.match(/^\/subscriptions\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelMatch) {
        return sendJson(response, 200, await service.cancelSubscription(decodeURIComponent(cancelMatch[1])));
      }
      if (method === 'POST' && url.pathname === '/webhooks/payment-provider') {
        const raw = await readRaw(request);
        const signature = request.headers['x-provider-signature'];
        if (!validSignature(raw, signature, webhookSecret)) return sendJson(response, 401, { error: 'Invalid signature' });
        let payload;
        try { payload = JSON.parse(raw); } catch { return sendJson(response, 400, { error: 'Malformed JSON payload' }); }
        return sendJson(response, 200, await service.processWebhook(payload));
      }
      return sendJson(response, 404, { error: 'Route not found' });
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      return sendJson(response, status, { error: error.message });
    }
  });
}

function validSignature(raw, supplied, secret) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  let actual;
  try { actual = Buffer.from(supplied, 'hex'); } catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function readBody(request) {
  const raw = await readRaw(request);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Malformed JSON payload'); }
}
function readRaw(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}
