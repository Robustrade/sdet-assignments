import express, { NextFunction, Request, Response } from 'express';
import { DomainError } from '../services/errors';
import { SubscriptionService } from '../services/SubscriptionService';
import { WebhookService } from '../services/WebhookService';

type Handler = (req: Request, res: Response) => Promise<void> | void;

const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res)).catch(next);
};

export function createHttpApp(subscriptions: SubscriptionService, webhooks: WebhookService): express.Express {
  const app = express();

  // The webhook route needs the exact bytes that were signed, so it gets a raw body parser.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: () => true, limit: '64kb' }),
    route((req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const receipt = webhooks.receive(raw, req.header('X-Provider-Signature'));
      res.status(200).json(receipt);
    }),
  );

  app.use(express.json({ limit: '16kb' }));

  app.post(
    '/subscriptions',
    route(async (req, res) => {
      const result = await subscriptions.create(req.body, req.header('Idempotency-Key') ?? undefined);
      if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(result.status).json(result.body);
    }),
  );

  app.get(
    '/subscriptions/:id',
    route((req, res) => {
      res.status(200).json(subscriptions.get(req.params.id as string));
    }),
  );

  app.post(
    '/subscriptions/:id/cancel',
    route((req, res) => {
      res.status(200).json(subscriptions.cancel(req.params.id as string));
    }),
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      res.status(error.httpStatus).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof SyntaxError || (error as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Body is not valid JSON' } });
      return;
    }
    res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error' } });
  });

  return app;
}
