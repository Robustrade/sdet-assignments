import { Router, Request, Response } from 'express';
import { SubscriptionService } from '../domain/subscription/SubscriptionService';
import { WebhookEventRepository } from '../infrastructure/persistence/WebhookEventRepository';
import { WebhookPayload, WebhookEvent } from '../domain/subscription/types';
import { createHmac } from 'crypto';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret_key';

function verifyWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return signature === expectedSignature;
}

export function createWebhookRoutes(
  service: SubscriptionService,
  webhookEventRepo: WebhookEventRepository
): Router {
  const router = Router();

  // POST /webhooks/payment-provider - Handle payment provider webhooks
  router.post('/payment-provider', async (req: Request, res: Response) => {
    try {
      const signature = req.headers['x-provider-signature'] as string;
      const payload: WebhookPayload = req.body;

      // Verify signature
      if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
      }

      const rawBody = JSON.stringify(payload);
      if (!verifyWebhookSignature(rawBody, signature)) {
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Validate payload
      if (!payload.event_id || !payload.type || !payload.subscription_id) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      // Check for duplicate event
      const existingEvents = await webhookEventRepo.findByEventId(payload.event_id);
      if (existingEvents.length > 0) {
        // Duplicate event - return success but don't process
        const event: WebhookEvent = {
          event_id: payload.event_id,
          type: payload.type,
          subscription_id: payload.subscription_id,
          invoice_id: payload.invoice_id || '',
          processed_at: new Date(),
          is_duplicate: true
        };
        await webhookEventRepo.save(event);
        return res.status(200).json({ message: 'Event already processed' });
      }

      // Process webhook based on type
      switch (payload.type) {
        case 'payment.succeeded':
          await service.handlePaymentSuccess(
            payload.subscription_id,
            payload.invoice_id || ''
          );
          break;
        case 'payment.failed':
          await service.handlePaymentFailure(
            payload.subscription_id,
            payload.invoice_id || ''
          );
          break;
        default:
          return res.status(400).json({ error: `Unknown event type: ${payload.type}` });
      }

      // Record event
      const event: WebhookEvent = {
        event_id: payload.event_id,
        type: payload.type,
        subscription_id: payload.subscription_id,
        invoice_id: payload.invoice_id || '',
        processed_at: new Date(),
        is_duplicate: false
      };
      await webhookEventRepo.save(event);

      res.status(200).json({ message: 'Webhook processed' });
    } catch (error: any) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
