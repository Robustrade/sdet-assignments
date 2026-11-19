import express, { NextFunction, Request, Response } from 'express';
import { AppError } from '../domain/errors';
import { SubscriptionService } from '../services/subscription-service';
import { WebhookService } from '../services/webhook-service';
import { presentSubscription } from './presenters';
import { parseCreateSubscriptionRequest, parseIdempotencyKey } from './validation';

type AsyncHandler = (req: Request, res: Response) => Promise<void> | void;

/** Express 4 does not catch rejected promises by itself; forward them to the error handler. */
const handle =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export interface HttpDependencies {
  subscriptions: SubscriptionService;
  webhooks: WebhookService;
  logError: (error: unknown) => void;
}

/** The four required endpoints, with the assignment's exact paths. Routes stay thin: parse -> service -> present. */
export function createHttpApp(deps: HttpDependencies): express.Express {
  const app = express();

  app.post(
    '/subscriptions',
    express.json(),
    handle(async (req, res) => {
      const input = parseCreateSubscriptionRequest(req.body);
      const key = parseIdempotencyKey(req.header('Idempotency-Key'));
      const { subscription, replayed } = await deps.subscriptions.create(input, key);
      if (replayed) res.set('Idempotent-Replayed', 'true');
      res.status(201).json(presentSubscription(subscription));
    }),
  );

  app.get(
    '/subscriptions/:id',
    handle((req, res) => {
      res.status(200).json(presentSubscription(deps.subscriptions.get(req.params.id)));
    }),
  );

  app.post(
    '/subscriptions/:id/cancel',
    handle((req, res) => {
      res.status(200).json(presentSubscription(deps.subscriptions.cancel(req.params.id)));
    }),
  );

  // Raw body (Buffer) is required: the HMAC is verified over the exact bytes received.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: () => true }),
    handle((req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(200).json(deps.webhooks.handle(rawBody, req.header('X-Provider-Signature')));
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Central error mapping -> documented error body { error: { code, message, details? } }.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof AppError) {
      res.status(error.httpStatus).json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
      return;
    }
    if (isJsonParseError(error)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } });
      return;
    }
    deps.logError(error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });

  return app;
}

function isJsonParseError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.parse.failed';
}
