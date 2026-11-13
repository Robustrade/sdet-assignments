
import { PaymentService } from './services/PaymentService';
import express, { Request, Response } from 'express';
import { SubscriptionService } from './services/SubscriptionService';
import { WebhookService } from './services/WebhookService';

export function createApp(
  subscriptionService: SubscriptionService,
  paymentService: PaymentService,
  webhookService: WebhookService
) {
  const app = express();

  app.use(
    express.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      }
    })
  );

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok'
    });
  });

  app.post('/subscriptions', (req: Request, res: Response) => {
    try {
      const { id, customerId, planId } = req.body;

      if (!id || !customerId || !planId) {
        return res.status(400).json({
          error: 'id, customerId and planId are required'
        });
      }

      const subscription = subscriptionService.create(
        id,
        customerId,
        planId
      );

      return res.status(201).json(subscription);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Internal server error';

      if (message.startsWith('Customer not found:')) {
        return res.status(404).json({ error: message });
      }

      return res.status(400).json({ error: message });
    }
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.getById(req.params.id);

      return res.status(200).json(subscription);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Internal server error';

      if (message.startsWith('Subscription not found:')) {
        return res.status(404).json({ error: message });
      }

      return res.status(400).json({ error: message });
    }
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    try {
      const subscription = subscriptionService.cancel(req.params.id);

      return res.status(200).json(subscription);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Internal server error';

      if (message.startsWith('Subscription not found:')) {
        return res.status(404).json({ error: message });
      }

      return res.status(400).json({ error: message });
    }
  });

  app.post(
    '/invoices/:invoiceId/payments',
    async (req: Request, res: Response) => {
      try {
        const { paymentId } = req.body;

        if (!paymentId) {
          return res.status(400).json({
            error: 'paymentId is required'
          });
        }

        const payment = await paymentService.processPayment(
          req.params.invoiceId,
          paymentId
        );

        return res.status(200).json(payment);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Internal server error';

        if (message.startsWith('Invoice not found:')) {
          return res.status(404).json({ error: message });
        }

        return res.status(400).json({ error: message });
      }
    }
  );

  app.post('/webhooks/payment-provider', (req, res) => {
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    const signature = req.header('X-Provider-Signature');
  
    if (!signature) {
      return res.status(401).json({ error: 'Missing webhook signature' });
    }
  
    if (!rawBody) {
      return res.status(400).json({ error: 'Missing webhook payload' });
    }
  
    try {
      const result = webhookService.process(rawBody, signature);
      return res.status(200).json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Webhook processing failed';
  
      if (message === 'Invalid webhook signature') {
        return res.status(401).json({ error: message });
      }
  
      if (message.includes('not found')) {
        return res.status(404).json({ error: message });
      }
  
      return res.status(400).json({ error: message });
    }
  });

  return app;
}
