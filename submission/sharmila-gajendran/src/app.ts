import express, { type Express, type Request, type Response } from 'express';
import { DEFAULT_MAX_FAILED_ATTEMPTS } from './config';
import type { Clock } from './domain/clock';
import { NotFoundError } from './domain/errors';
import { RandomIdGenerator, type IdGenerator } from './domain/ids';
import { PlanCatalog } from './domain/plans';
import { errorBody, errorHandler } from './http/errorHandler';
import { parseCreateSubscription, parseWebhookEvent } from './http/requestParsers';
import { isValidSignature } from './http/signature';
import { toSubscriptionDto } from './http/subscriptionDto';
import type { Db } from './persistence/database';
import { createRepositories, type Repositories } from './persistence/repositories';
import type { PaymentProvider } from './providers/paymentProvider';
import { BillingService } from './services/billingService';
import { PaymentSettlement } from './services/paymentSettlement';
import { SubscriptionLifecycle } from './services/subscriptionLifecycle';
import { SubscriptionService } from './services/subscriptionService';
import { WebhookService } from './services/webhookService';

export interface AppDependencies {
  readonly db: Db;
  readonly paymentProvider: PaymentProvider;
  readonly clock: Clock;
  readonly webhookSecret: string;
  readonly idGenerator?: IdGenerator;
  readonly plans?: PlanCatalog;
  readonly maxFailedAttempts?: number;
  /** Lets tests swap a repository, e.g. to make a write fail halfway through. */
  readonly repositoryOverrides?: Partial<Repositories>;
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') {
    throw new NotFoundError(`Missing route parameter '${name}'`, 'NOT_FOUND');
  }
  return value;
}

/** Composition root: builds every service from the injected dependencies and wires the routes. */
export function createApp(deps: AppDependencies): Express {
  const repos = createRepositories(deps.db, deps.repositoryOverrides);
  const plans = deps.plans ?? new PlanCatalog();
  const ids = deps.idGenerator ?? new RandomIdGenerator();
  const lifecycle = new SubscriptionLifecycle(repos, deps.clock);
  const settlement = new PaymentSettlement(
    repos,
    lifecycle,
    plans,
    deps.clock,
    deps.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS,
  );
  const billing = new BillingService(deps.db, repos, plans, deps.paymentProvider, settlement, deps.clock, ids);
  const subscriptions = new SubscriptionService(deps.db, repos, plans, lifecycle, billing, deps.clock, ids);
  const webhooks = new WebhookService(deps.db, repos, settlement, deps.clock);

  const app = express();
  app.disable('x-powered-by');

  app.post('/subscriptions', express.json(), async (req: Request, res: Response) => {
    const input = parseCreateSubscription(req.body);
    const subscription = await subscriptions.create(input);
    res.status(201).json(toSubscriptionDto(subscription));
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    res.status(200).json(toSubscriptionDto(subscriptions.get(routeParam(req, 'id'))));
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    res.status(200).json(toSubscriptionDto(subscriptions.cancel(routeParam(req, 'id'))));
  });

  // Raw body on purpose: the signature is checked over the exact bytes the provider sent,
  // before the body is parsed or any business logic runs.
  app.post('/webhooks/payment-provider', express.raw({ type: () => true }), (req: Request, res: Response) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSignature(rawBody, req.header('x-provider-signature'), deps.webhookSecret)) {
      res.status(401).json(errorBody('INVALID_SIGNATURE', 'Missing or invalid X-Provider-Signature'));
      return;
    }
    const event = parseWebhookEvent(rawBody.toString('utf8'));
    const outcome = webhooks.process(event);
    res.status(200).json({ event_id: event.eventId, outcome });
  });

  // Test harness only: stands in for a scheduler so tests decide when billing happens.
  app.post('/internal/billing/run', async (_req: Request, res: Response) => {
    const attempted = await billing.runDueCharges();
    res.status(200).json({ attempted });
  });

  app.use(errorHandler);
  return app;
}
