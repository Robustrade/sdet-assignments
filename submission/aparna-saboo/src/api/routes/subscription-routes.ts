import { Router, type Request, type Response } from 'express';
import type { SubscriptionService } from '../../application/services/subscription-service';
import type { WebhookProcessingService } from '../../application/services/webhook-processing-service';
import type { WebhookService } from '../../application/services/webhook-service';

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const sendError = (res: Response, status: number, message: string) => {
  return res.status(status).json({ message });
};

export const createSubscriptionRoutes = (
  subscriptionService: SubscriptionService,
  webhookService: WebhookService,
  webhookProcessingService: WebhookProcessingService,
) => {
  const router = Router();

  router.post('/subscriptions', async (req: Request, res: Response) => {
    const body = req.body ?? {};

    if (typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, 'Request body is required');
    }

    const customerId = body.customer_id;
    const plan = body.plan;
    const paymentMethodId = body.payment_method_id;

    if (!isNonEmptyString(customerId)) {
      return sendError(res, 400, 'customer_id is required');
    }

    if (!isNonEmptyString(plan)) {
      return sendError(res, 400, 'plan is required');
    }

    if (!isNonEmptyString(paymentMethodId)) {
      return sendError(res, 400, 'payment_method_id is required');
    }

    try {
      const subscription = await subscriptionService.createSubscription({
        customerId,
        plan,
        paymentMethodId,
      });

      return res.status(201).json(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create subscription';
      return sendError(res, 400, message);
    }
  });

  router.get('/subscriptions/:id', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const subscription = subscriptionService.getSubscription(id);
      return res.status(200).json(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Subscription not found';
      if (message.startsWith('Subscription not found')) {
        return sendError(res, 404, 'Subscription not found');
      }
      return sendError(res, 400, message);
    }
  });

  router.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const subscription = await subscriptionService.cancelSubscription(id);
      return res.status(200).json(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel subscription';

      if (message.startsWith('Subscription not found')) {
        return sendError(res, 404, 'Subscription not found');
      }

      if (message.startsWith('Subscription already canceled')) {
        return sendError(res, 409, 'Subscription already canceled');
      }

      return sendError(res, 400, message);
    }
  });

  router.post('/webhooks/payment-provider', (req: Request, res: Response) => {
    const body = req.body ?? {};
    const signature = req.get('X-Provider-Signature');

    if (!signature || signature.trim().length === 0) {
      return sendError(res, 400, 'Missing X-Provider-Signature header');
    }

    try {
      const event = webhookService.processWebhook(body, signature);
      const result = webhookProcessingService.processWebhook(event, Number(body.amount), body.currency);
      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook processing failed';

      if (message.startsWith('Subscription not found')) {
        return sendError(res, 404, message);
      }

      if (message.includes('Invalid signature') || message.includes('Missing signature') || message.includes('Payload') || message.includes('event_id') || message.includes('subscription_id') || message.includes('invoice_id') || message.includes('amount') || message.includes('currency') || message.includes('type')) {
        return sendError(res, 400, message);
      }

      return sendError(res, 500, 'Webhook processing failed');
    }
  });

  return router;
};
