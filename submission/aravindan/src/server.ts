const http = require('http');
const { SubscriptionService } = require('./billing/SubscriptionService');
const { PaymentProviderMock } = require('./billing/PaymentProvider');

const service = new SubscriptionService({
  paymentProvider: new PaymentProviderMock(),
});

const parseJsonBody = async (req: import('http').IncomingMessage) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString();
  if (!raw) {
    return { rawBody: '', payload: null };
  }

  try {
    const payload = JSON.parse(raw);
    return { rawBody: raw, payload };
  } catch (error) {
    return { rawBody: raw, payload: null, parseError: error };
  }
};

const sendJson = (res: import('http').ServerResponse, statusCode: number, payload: unknown) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    return sendJson(res, 200, { ok: true, status: 'healthy' });
  }

  if (method === 'POST' && url === '/subscriptions') {
    try {
      const { rawBody, payload, parseError } = await parseJsonBody(req);
      if (parseError) {
        return sendJson(res, 400, { ok: false, error: 'Malformed JSON body' });
      }

      const subscription = await service.createSubscription(payload || {});
      return sendJson(res, 201, { ok: true, subscription });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (method === 'GET' && url && /^\/subscriptions\/[^/]+$/.test(url)) {
    const subscriptionId = url.split('/').filter(Boolean)[1]!;
    try {
      const subscription = service.getSubscription(subscriptionId);
      return sendJson(res, 200, { ok: true, subscription });
    } catch (error) {
      return sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (method === 'POST' && url && /^\/subscriptions\/[^/]+\/cancel$/.test(url)) {
    const subscriptionId = url.split('/').filter(Boolean)[1]!;
    try {
      const subscription = await service.cancelSubscription(subscriptionId);
      return sendJson(res, 200, { ok: true, subscription });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (method === 'POST' && url === '/webhooks/payment-provider') {
    try {
      const { payload, rawBody, parseError } = await parseJsonBody(req);
      const signature = req.headers['x-provider-signature'];

      if (parseError || !payload) {
        return sendJson(res, 400, { ok: false, error: 'Malformed webhook payload' });
      }

      const result = await service.processWebhook(payload, rawBody, signature);
      if (result.status) {
        return sendJson(res, result.status, { ok: false, error: result.error });
      }

      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Subscription billing service listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { server, service };
