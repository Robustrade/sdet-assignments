import express, { Express, Request, Response, NextFunction } from 'express';
import { SubscriptionService } from '../domain/subscription/SubscriptionService';
import { PaymentProvider } from '../infrastructure/payment/PaymentProvider';
import { SubscriptionRepository } from '../infrastructure/persistence/SubscriptionRepository';
import { InvoiceRepository } from '../infrastructure/persistence/InvoiceRepository';
import { WebhookEventRepository } from '../infrastructure/persistence/WebhookEventRepository';
import { InMemoryDatabase } from '../infrastructure/persistence/InMemoryDatabase';
import { createSubscriptionRoutes } from './subscriptionRoutes';
import { createWebhookRoutes } from './webhookRoutes';

export interface AppDependencies {
  subscriptionRepo: SubscriptionRepository;
  invoiceRepo: InvoiceRepository;
  webhookEventRepo: WebhookEventRepository;
  paymentProvider: PaymentProvider;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  // Create service
  const subscriptionService = new SubscriptionService(
    dependencies.subscriptionRepo,
    dependencies.invoiceRepo,
    dependencies.paymentProvider
  );

  // Mount routes
  app.use('/subscriptions', createSubscriptionRoutes(subscriptionService));
  app.use('/webhooks', createWebhookRoutes(
    subscriptionService,
    dependencies.webhookEventRepo
  ));

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}
