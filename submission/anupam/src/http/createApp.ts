import express, { type NextFunction, type Request, type Response } from 'express';
import { DomainError } from '../domain/errors';
import type { Container } from '../app/container';
import { toSubscriptionDto } from './presenters';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const route = (h: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(h(req, res)).catch(next);

export function createApp(c: Container): express.Express {
  const app = express();
  const present = (id: string) =>
    toSubscriptionDto(c.repos.subscriptions.getById(id), c.repos.invoices.latestForSubscription(id));

  // Webhook route needs the RAW body for HMAC verification -> registered before express.json().
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: '*/*', limit: '64kb' }),
    route((req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(200).json(c.webhooks.handle(raw, req.header('X-Provider-Signature')));
    }),
  );

  app.use(express.json());

  app.post('/subscriptions', route(async (req, res) => {
    const sub = await c.subscriptions.create(req.body ?? {});
    res.status(201).json(present(sub.id));
  }));

  app.get('/subscriptions/:id', route((req, res) => {
    c.subscriptions.get(req.params.id);
    res.status(200).json(present(req.params.id));
  }));

  app.post('/subscriptions/:id/cancel', route((req, res) => {
    c.subscriptions.cancel(req.params.id);
    res.status(200).json(present(req.params.id));
  }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.httpStatus).json({ error: { code: err.code, message: err.message, details: err.details ?? null } });
      return;
    }
    if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'validation_error', message: 'Malformed JSON body', details: null } });
      return;
    }
    res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error', details: null } });
  });

  return app;
}
