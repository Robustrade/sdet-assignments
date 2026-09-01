/**
 * Express App Fixture - Minimal Subscription & Billing Service
 * 
 * HTTP endpoints for testing:
 * - POST /subscriptions
 * - GET /subscriptions/:id
 * - POST /subscriptions/:id/cancel
 * - POST /webhooks/payment-provider
 */

import express, { Request, Response } from 'express';
import { SubscriptionService } from './domain/services/subscription-service';
import { WebhookProcessor } from './domain/services/webhook-processor';
import { CreateSubscriptionRequest, WebhookPayload } from './types';

export function createApp(
  subscriptionService: SubscriptionService,
  webhookProcessor: WebhookProcessor
) {
  const app = express();

  // Capture raw payload before JSON parsing so webhook signatures verify correctly.
  app.use(
    express.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf.toString();
      },
    })
  );

  /**
   * POST /subscriptions
   * Create a new subscription
   */
  app.post('/subscriptions', async (req: Request, res: Response) => {
    try {
      const request: CreateSubscriptionRequest = req.body;

      // Validation
      if (!request.customer_id || !request.plan || !request.payment_method_id) {
        return res.status(400).json({
          error: 'Missing required fields: customer_id, plan, payment_method_id',
        });
      }

      const subscription = await subscriptionService.createSubscription(request);
      res.status(201).json(subscription);
    } catch (err: any) {
      if (
        err.message.includes('Unknown plan') ||
        err.message.includes('Customer not found')
      ) {
        return res.status(422).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /subscriptions/:id
   * Retrieve subscription details
   */
  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.getSubscription(req.params.id);
      res.status(200).json(subscription);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /subscriptions/:id/cancel
   * Cancel subscription
   */
  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.cancelSubscription(req.params.id);
      res.status(200).json(subscription);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes('already canceled')) {
        return res.status(422).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /webhooks/payment-provider
   * Inbound webhook from payment provider
   * 
   * Expects:
   * - Body: WebhookPayload
   * - Header: X-Provider-Signature (HMAC-SHA256)
   */
  app.post('/webhooks/payment-provider', async (req: Request, res: Response) => {
    try {
      const payload: WebhookPayload = req.body;
      const signature = req.headers['x-provider-signature'] as string;

      // Validation
      if (!signature) {
        return res.status(403).json({ error: 'Missing X-Provider-Signature header' });
      }

      const rawBody = (req as any).rawBody;
      const result = await webhookProcessor.processWebhook(payload, signature);
      res.status(200).json({ event_id: result.eventId, processed: result.processed });
    } catch (err: any) {
      if (err.message.includes('Invalid webhook signature')) {
        return res.status(403).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  return app;
}
