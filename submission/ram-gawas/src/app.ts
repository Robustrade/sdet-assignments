import express from 'express';
import { SubscriptionService } from './subscription-service';
import { verifyWebhookSignature } from './webhook-signature';
import { getPlan } from './plans/plan-registry';

export function createApp(
  subscriptionService: SubscriptionService,
  webhookSecret = 'test_webhook_secret',
) {
  const app = express();

  app.use(express.json());

  app.post('/subscriptions', async (req, res) => {
    try {
      const {
        id,
        customerId,
        plan,
        paymentMethodId,
      } = req.body;

      if (!id || !customerId || !plan || !paymentMethodId) {
        return res.status(400).json({
          error: 'Missing required fields',
        });
      }

      if (!getPlan(plan)) {
        return res.status(400).json({
          error: 'Invalid plan',
        });
      }

      const subscription =
        await subscriptionService.createSubscription({
          id,
          customerId,
          plan,
          paymentMethodId,
        });

      return res.status(201).json(subscription);
    } catch {
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  app.get('/subscriptions/:id', async (req, res) => {
    try {
      const subscription =
        subscriptionService.getSubscription(req.params.id);

      if (!subscription) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      return res.status(200).json(subscription);
    } catch {
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  app.post('/subscriptions/:id/cancel', async (req, res) => {
    try {
      const subscription =
        await subscriptionService.cancelSubscription(
          req.params.id,
        );

      return res.status(200).json(subscription);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Subscription not found'
      ) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      if (
        error instanceof Error &&
        error.message.includes(
          'Invalid subscription transition',
        )
      ) {
        return res.status(409).json({
          error: 'Subscription cannot be canceled',
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  });

  app.post('/webhooks/payment-provider', async (req, res) => {
    try {
      const signature = req.header('X-Provider-Signature');

      if (!signature) {
        return res.status(401).json({
          error: 'Missing webhook signature',
        });
      }

      const isValid = verifyWebhookSignature(
        req.body,
        signature,
        webhookSecret,
      );

      if (!isValid) {
        return res.status(401).json({
          error: 'Invalid webhook signature',
        });
      }

      const {
        eventId,
        type,
        subscriptionId,
        invoiceId,
        amount,
      } = req.body;

      if (
        !eventId ||
        !type ||
        !subscriptionId ||
        !invoiceId ||
        typeof amount !== 'number'
      ) {
        return res.status(400).json({
          error: 'Invalid webhook payload',
        });
      }

      if (
        !['payment.succeeded', 'payment.failed'].includes(type)
      ) {
        return res.status(400).json({
          error: 'Invalid webhook payload',
        });
      }

      const result =
        await subscriptionService.handleWebhook(req.body);

      return res.status(200).json(result);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Subscription not found'
      ) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      return res.status(400).json({
        error: 'Invalid webhook',
      });
    }
  });

  return app;
}
