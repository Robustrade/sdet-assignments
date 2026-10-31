
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { InMemoryRepository } from './repository.js';
import { MockPaymentProvider } from './payment-provider.js';
import { SubscriptionService } from './subscription-service.js';

export function createApp(
  repository = new InMemoryRepository(),
  paymentProvider = new MockPaymentProvider(),
) {
  const subscriptionService = new SubscriptionService(
    repository,
    paymentProvider,
  );

  const app = express();

  app.use(express.json());

  
app.post(
  '/webhooks/payment',
  (req: Request, res: Response, next) => {
    const signature = req.header('x-webhook-signature');

    if (!signature || typeof req.body !== 'object' || req.body === null) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const expectedSignature = createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    next();
  },
  (req: Request, res: Response) => {
  const { eventId, subscriptionId, invoiceId, type } = req.body;

  if (
    typeof eventId !== 'string' ||
    typeof subscriptionId !== 'string' ||
    typeof invoiceId !== 'string' ||
    !['payment.succeeded', 'payment.failed', 'payment.refunded'].includes(type)
  ) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  const existingEvent = repository.getPaymentEvent(eventId);

  if (existingEvent) {
    res.status(200).json({
      message: 'Event already processed',
      duplicate: true,
    });
    return;
  }

  const subscription = repository.getSubscription(subscriptionId);
  const invoice = repository.getInvoice(invoiceId);

  if (!subscription || !invoice || invoice.subscriptionId !== subscriptionId) {
    res.status(404).json({ error: 'Subscription or invoice not found' });
    return;
  }

  if (type === 'payment.succeeded') {
    repository.saveInvoice({
      ...invoice,
      status: 'paid',
    });

    if (subscription.status === 'trialing' || subscription.status === 'past_due') {
      repository.saveSubscription({
        ...subscription,
        status: 'active',
        updatedAt: new Date().toISOString(),
      });
    }
  } else if (type === 'payment.failed') {
    if (invoice.status !== 'paid' && invoice.status !== 'refunded') {
      repository.saveInvoice({
        ...invoice,
        status: 'failed',
      });

      if (subscription.status === 'trialing' || subscription.status === 'active') {
        repository.saveSubscription({
          ...subscription,
          status: 'past_due',
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } else if (type === 'payment.refunded') {
    repository.saveInvoice({
      ...invoice,
      status: 'refunded',
    });
  }

  repository.savePaymentEvent({
    eventId,
    subscriptionId,
    invoiceId,
    type,
    receivedAt: new Date().toISOString(),
    processed: true,
  });

  res.status(200).json({
    message: 'Webhook processed successfully',
    duplicate: false,
  });
},
);

  app.post('/subscriptions', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.createSubscription(req.body);
      res.status(201).json(subscription);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';

      const status =
        message === 'Unknown customer' ||
        message === 'Unknown plan' ||
        message === 'Invalid payment method'
          ? 400
          : 500;

      res.status(status).json({ error: message });
    }
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    const subscription = subscriptionService.getSubscription(
      String(req.params.id),
    );

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.status(200).json(subscription);
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.cancelSubscription(
        String(req.params.id),
      );
      res.status(200).json(subscription);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';

      const status = message === 'Unknown subscription' ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });

  return app;
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'test_webhook_secret';

export const app = createApp();
