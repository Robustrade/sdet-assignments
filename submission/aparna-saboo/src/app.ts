import express from 'express';
import { DefaultSubscriptionService } from './application/services/subscription-service';
import { WebhookProcessingService } from './application/services/webhook-processing-service';
import { WebhookService } from './application/services/webhook-service';
import { InMemoryInvoiceRepository } from './infrastructure/persistence/in-memory-invoice-repository';
import { InMemorySubscriptionRepository } from './infrastructure/persistence/in-memory-subscription-repository';
import { InMemoryWebhookEventRepository } from './infrastructure/persistence/in-memory-webhook-event-repository';
import { MockPaymentProvider } from './infrastructure/payment/mock-payment-provider';
import { createSubscriptionRoutes } from './api/routes/subscription-routes';

export const createApp = () => {
  const app = express();
  app.use(express.json());

  const subscriptionRepository = new InMemorySubscriptionRepository();
  const invoiceRepository = new InMemoryInvoiceRepository();
  const webhookEventRepository = new InMemoryWebhookEventRepository();
  const paymentProvider = new MockPaymentProvider();
  const subscriptionService = new DefaultSubscriptionService(subscriptionRepository, paymentProvider);
  const webhookService = new WebhookService();
  const webhookProcessingService = new WebhookProcessingService(
    subscriptionRepository,
    invoiceRepository,
    webhookEventRepository,
  );

  app.locals.subscriptionRepository = subscriptionRepository;
  app.locals.invoiceRepository = invoiceRepository;
  app.locals.webhookEventRepository = webhookEventRepository;
  app.locals.paymentProvider = paymentProvider;
  app.locals.subscriptionService = subscriptionService;
  app.locals.webhookService = webhookService;
  app.locals.webhookProcessingService = webhookProcessingService;

  app.use(createSubscriptionRoutes(subscriptionService, webhookService, webhookProcessingService));

  return app;
};

export const app = createApp();
