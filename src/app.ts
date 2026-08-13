import express from 'express';
import type { SubscriptionService } from './services/SubscriptionService.js';
import type { WebhookService } from './services/WebhookService.js';
import { createSubscriptionsRouter } from './routes/subscriptions.routes.js';
import { createWebhooksRouter } from './routes/webhooks.routes.js';

export interface AppDeps {
  subscriptionService: SubscriptionService;
  webhookService: WebhookService;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();

  const subscriptionsRouter = createSubscriptionsRouter(deps.subscriptionService);
  app.use('/subscriptions', subscriptionsRouter);

  app.use('/webhooks', createWebhooksRouter(deps.webhookService));

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const message = err instanceof Error ? err.message : 'internal error';
      res.status(500).json({ error: message });
    },
  );

  return app;
}