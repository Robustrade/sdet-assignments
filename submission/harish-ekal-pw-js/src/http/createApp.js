const crypto = require('crypto');
const express = require('express');

function createApp({ service, webhookSecret }) {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('content-type', 'application/json');
    next();
  });

  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.header('X-Provider-Signature');
      if (!signature) {
        return res
          .status(401)
          .send(JSON.stringify({ error: 'missing_signature' }));
      }

      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body)
        .digest('hex');
      if (signature !== expected) {
        return res
          .status(401)
          .send(JSON.stringify({ error: 'invalid_signature' }));
      }

      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf-8'));
      } catch {
        return res
          .status(400)
          .send(JSON.stringify({ error: 'malformed_payload' }));
      }

      const required = [
        'event_id',
        'type',
        'subscription_id',
        'invoice_id',
        'amount',
        'currency',
      ];
      for (const field of required) {
        if (payload[field] === undefined || payload[field] === null) {
          return res
            .status(400)
            .send(JSON.stringify({ error: 'invalid_payload', field }));
        }
      }

      const result = await service.processWebhook(payload);
      return res.status(200).send(JSON.stringify({ ok: true, ...result }));
    },
  );

  app.use(express.json());

  app.post('/subscriptions', async (req, res) => {
    try {
      const body = req.body || {};
      const sub = await service.createSubscription({
        customerId: body.customer_id,
        plan: body.plan,
        paymentMethodId: body.payment_method_id,
      });
      return res.status(201).json(sub);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message });
    }
  });

  app.get('/subscriptions/:id', (req, res) => {
    const sub = service.getSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.status(200).json(sub);
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    try {
      const sub = service.cancelSubscription(req.params.id);
      return res.status(200).json(sub);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message });
    }
  });

  return app;
}

module.exports = {
  createApp,
};
