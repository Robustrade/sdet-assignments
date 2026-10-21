const express = require('express');
const { ApiError } = require('./errors');
const { isValidSignature } = require('./signature');

/**
 * HTTP layer. Webhook *request handling* (signature, JSON parsing) lives here;
 * webhook *business logic* lives in BillingService.handleWebhook.
 */
function createApp({ service, webhookSecret }) {
  const app = express();

  // Needs the raw bytes: the signature is computed over the exact body received.
  app.post('/webhooks/payment-provider', express.raw({ type: () => true }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSignature(rawBody, req.get('X-Provider-Signature'), webhookSecret)) {
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new ApiError(400, 'MALFORMED_PAYLOAD', 'Webhook body is not valid JSON');
    }
    res.status(200).json(service.handleWebhook(event));
  });

  app.use(express.json());

  app.post('/subscriptions', async (req, res) => {
    res.status(201).json(await service.createSubscription(req.body));
  });

  app.get('/subscriptions/:id', (req, res) => {
    res.json(service.getSubscription(req.params.id));
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    res.json(service.cancelSubscription(req.params.id));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'MALFORMED_JSON', message: 'Request body is not valid JSON' });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  return app;
}

module.exports = { createApp };
