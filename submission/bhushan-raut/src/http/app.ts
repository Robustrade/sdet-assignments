import express, { type ErrorRequestHandler, type Express, type Response } from 'express';
import type { Clock } from '../clock';
import { PlanCatalog } from '../domain/PlanCatalog';
import { SequentialIds } from '../ids';
import type { Notifier } from '../notifier';
import { BillingRepository } from '../persistence/BillingRepository';
import { CustomerRepository } from '../persistence/CustomerRepository';
import type { Db } from '../persistence/database';
import { SubscriptionRepository, type SubscriptionRecord } from '../persistence/SubscriptionRepository';
import { WebhookEventRepository } from '../persistence/WebhookEventRepository';
import type { PaymentProvider } from '../provider/PaymentProvider';
import { BillingService } from '../services/BillingService';
import { PaymentOutcomeApplier } from '../services/PaymentOutcomeApplier';
import { SubscriptionService } from '../services/SubscriptionService';
import { parseEvent, WebhookProcessor } from '../services/WebhookProcessor';
import { isValidSignature } from './webhookSignature';

export interface AppDependencies {
  db: Db;
  clock: Clock;
  paymentProvider: PaymentProvider;
  notifier: Notifier;
  webhookSecret: string;
  plans?: PlanCatalog;
}

/** Composition root: every collaborator is injected, so tests control the provider, clock and database. */
export function createApp(deps: AppDependencies): Express {
  const { db, clock, notifier } = deps;
  const plans = deps.plans ?? new PlanCatalog();
  const ids = new SequentialIds();
  const subscriptionRepo = new SubscriptionRepository(db);
  const billingRepo = new BillingRepository(db);
  const applier = new PaymentOutcomeApplier(subscriptionRepo, billingRepo);
  const billing = new BillingService(db, subscriptionRepo, billingRepo, plans, deps.paymentProvider, applier, notifier, clock, ids);
  const subscriptions = new SubscriptionService(subscriptionRepo, new CustomerRepository(db), plans, billing, clock, ids);
  const webhooks = new WebhookProcessor(db, new WebhookEventRepository(db), subscriptionRepo, billingRepo, applier, notifier, clock);

  const app = express();

  // Raw body: the signature is verified over the exact bytes received, before any parsing.
  app.post('/webhooks/payment-provider', express.raw({ type: () => true }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSignature(rawBody, req.get('X-Provider-Signature'), deps.webhookSecret)) {
      return sendError(res, 401, 'invalid_signature');
    }
    const event = parseEvent(rawBody);
    if (typeof event === 'string') return sendError(res, 400, 'malformed_payload', event);
    return res.status(200).json(webhooks.process(event, rawBody));
  });

  app.use(express.json());

  app.post('/subscriptions', async (req, res) => {
    const result = await subscriptions.create(req.body);
    if (result.kind === 'invalid') return sendError(res, result.httpStatus, result.code, undefined, result.field);
    return res.status(201).json(toView(result.subscription));
  });

  app.get('/subscriptions/:id', (req, res) => {
    const sub = subscriptions.find(req.params.id);
    return sub ? res.json(toView(sub)) : sendError(res, 404, 'not_found');
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    const result = subscriptions.cancel(req.params.id);
    switch (result.kind) {
      case 'not_found':
        return sendError(res, 404, 'not_found');
      case 'invalid_transition':
        return sendError(res, 409, 'invalid_transition', `cannot cancel a ${result.status} subscription`);
      case 'canceled':
        return res.json(toView(result.subscription));
    }
  });

  app.post('/internal/billing/run', async (req, res) => {
    const id = (req.body as { subscription_id?: unknown } | undefined)?.subscription_id;
    if (typeof id !== 'string') return sendError(res, 400, 'validation_error', undefined, 'subscription_id');
    const result = await billing.run(id);
    switch (result.kind) {
      case 'not_found':
        return sendError(res, 404, 'not_found');
      case 'rejected':
        return sendError(res, 409, result.code);
      case 'charged':
        return res.json({ result: result.result, subscription: toView(result.subscription) });
    }
  });

  const onError: ErrorRequestHandler = (err: { type?: string }, _req, res, _next) => {
    void _next;
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'malformed_json');
    console.error(err);
    return sendError(res, 500, 'internal_error');
  };
  app.use(onError);

  return app;
}

function sendError(res: Response, status: number, code: string, message?: string, field?: string) {
  return res.status(status).json({ error: { code, ...(field && { field }), ...(message && { message }) } });
}

function toView(s: SubscriptionRecord) {
  return {
    id: s.id,
    customer_id: s.customerId,
    plan: s.plan,
    payment_method_id: s.paymentMethodId,
    status: s.status,
    trial_ends_at: s.trialEndsAt,
    current_period_end: s.currentPeriodEnd,
    retry_count: s.retryCount,
    canceled_at: s.canceledAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}
