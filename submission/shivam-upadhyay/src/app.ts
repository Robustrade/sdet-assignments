import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { BillingService } from './billing';
import type { PaymentProvider } from './provider';
import {
  AuditLogRepository,
  InMemoryStore,
  InvoiceRepository,
  SubscriptionRepository,
  WebhookEventRepository,
} from './store';
import { PLANS, type PlanId, type Subscription, type WebhookType } from './types';
import { verifyWebhookSignature } from './webhookVerify';

export interface AppDeps {
  provider: PaymentProvider;
  store?: InMemoryStore;
  now?: () => number;
  maxRetries?: number;
}

export interface CreatedApp {
  app: Express;
  store: InMemoryStore;
  billing: BillingService;
}

type RawBodyRequest = Request & { rawBody?: Buffer };

/** API contract is snake_case (per the assignment examples); the model is camelCase. */
export function toApiSubscription(sub: Subscription): Record<string, unknown> {
  return {
    id: sub.id,
    customer_id: sub.customerId,
    plan: sub.plan,
    payment_method_id: sub.paymentMethodId,
    state: sub.state,
    trial_ends_at: sub.trialEndsAt,
    retry_count: sub.retryCount,
    created_at: sub.createdAt,
    updated_at: sub.updatedAt,
  };
}

const WEBHOOK_TYPES: WebhookType[] = ['payment.succeeded', 'payment.failed', 'payment.refunded'];

export function createApp(deps: AppDeps): CreatedApp {
  const store = deps.store ?? new InMemoryStore();
  const now = deps.now ?? (() => Date.now());
  const subscriptions = new SubscriptionRepository(store);
  const invoices = new InvoiceRepository(store);
  const audit = new AuditLogRepository(store);
  const webhookEvents = new WebhookEventRepository(store);
  const billing = new BillingService({ provider: deps.provider, subscriptions, invoices, audit, now, maxRetries: deps.maxRetries });

  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );
  // Malformed JSON bodies fail closed with a 400, not a 500.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'malformed_payload' });
      return;
    }
    next(err);
  });

  app.post('/subscriptions', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const customerId = body['customer_id'];
    const plan = body['plan'];
    const paymentMethodId = body['payment_method_id'];
    if (typeof customerId !== 'string' || customerId.length === 0) {
      res.status(400).json({ error: 'missing_field', field: 'customer_id' });
      return;
    }
    if (typeof plan !== 'string' || !(plan in PLANS)) {
      res.status(400).json({ error: 'unknown_plan' });
      return;
    }
    if (typeof paymentMethodId !== 'string' || paymentMethodId.length === 0) {
      res.status(400).json({ error: 'missing_field', field: 'payment_method_id' });
      return;
    }
    if (!store.customers.has(customerId)) {
      res.status(400).json({ error: 'unknown_customer' });
      return;
    }
    const planDef = PLANS[plan as PlanId];
    const at = now();
    const sub: Subscription = {
      id: `sub_${Math.random().toString(36).slice(2, 10)}`,
      customerId,
      plan: plan as PlanId,
      paymentMethodId,
      state: 'trialing',
      trialEndsAt: at + planDef.trialDays * 24 * 60 * 60 * 1000,
      retryCount: 0,
      createdAt: at,
      updatedAt: at,
    };
    subscriptions.save(sub);
    audit.append({ subscriptionId: sub.id, kind: 'created', from: null, to: 'trialing', at });
    res.status(201).json(toApiSubscription(sub));
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    const sub = subscriptions.findById(req.params['id'] as string);
    if (!sub) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(200).json(toApiSubscription(sub));
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    const sub = subscriptions.findById(req.params['id'] as string);
    if (!sub) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const canceled = billing.cancel(sub);
    if (!canceled) {
      res.status(409).json({ error: 'cancel_not_allowed', state: sub.state });
      return;
    }
    res.status(200).json(toApiSubscription(canceled));
  });

  app.post('/webhooks/payment-provider', (req: Request, res: Response) => {
    const raw = (req as RawBodyRequest).rawBody ?? Buffer.from('');
    const signature = req.header('x-provider-signature');
    if (!verifyWebhookSignature(raw, signature)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const eventId = body['event_id'];
    const type = body['type'];
    const subscriptionId = body['subscription_id'];
    if (typeof eventId !== 'string' || eventId.length === 0) {
      res.status(400).json({ error: 'missing_field', field: 'event_id' });
      return;
    }
    if (typeof type !== 'string' || !WEBHOOK_TYPES.includes(type as WebhookType)) {
      res.status(400).json({ error: 'unknown_event_type' });
      return;
    }
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      res.status(400).json({ error: 'missing_field', field: 'subscription_id' });
      return;
    }
    const sub = subscriptions.findById(subscriptionId);
    if (!sub) {
      res.status(404).json({ error: 'subscription_not_found' });
      return;
    }
    // Idempotency: a redelivered event_id is acknowledged and ignored.
    if (webhookEvents.hasProcessed(eventId)) {
      res.status(200).json({ status: 'duplicate', subscription: toApiSubscription(sub) });
      return;
    }
    const invoiceId = typeof body['invoice_id'] === 'string' ? body['invoice_id'] : undefined;
    const amountCents = typeof body['amount'] === 'number' ? body['amount'] : 0;
    const currency = typeof body['currency'] === 'string' ? body['currency'] : 'USD';
    const result = billing.applyWebhook(
      { eventId, type: type as WebhookType, subscriptionId, invoiceId, amountCents, currency },
      (id: string) =>
        webhookEvents.record({
          eventId: id,
          type: type as WebhookType,
          subscriptionId,
          invoiceId,
          receivedAt: now(),
          processed: true,
        }),
    );
    res.status(200).json({ status: result.outcome, subscription: toApiSubscription(sub) });
  });

  return { app, store, billing };
}
