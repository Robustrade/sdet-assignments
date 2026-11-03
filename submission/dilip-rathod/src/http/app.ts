import express from 'express';
import type { ErrorRequestHandler, Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { BillingResult } from '../billing/BillingService';
import type { ServiceContainer } from '../container';
import type { Invoice, Subscription } from '../domain/types';
import { AppError, RequestValidationError } from '../shared/errors';
import { SIGNATURE_HEADER, WebhookEventSchema } from '../webhooks/WebhookService';

const CreateSubscriptionBody = z.object({
  customer_id: z.string().min(1),
  plan: z.string().min(1),
  payment_method_id: z.string().min(1),
});

const ChangePlanBody = z.object({ plan: z.string().min(1) });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RequestValidationError(parsed.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', issue: i.message })));
  }
  return parsed.data;
}

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined && { details }) } };
}

export function serializeInvoice(i: Invoice) {
  return {
    id: i.id,
    subscription_id: i.subscriptionId,
    plan: i.plan,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
    period_start: i.periodStart,
    period_end: i.periodEnd,
    created_at: i.createdAt,
    paid_at: i.paidAt,
  };
}

export function createApp(container: ServiceContainer): Express {
  const app = express();
  const service = container.subscriptions;

  const serializeSubscription = (s: Subscription) => {
    const latest = service.latestInvoice(s.id);
    return {
      id: s.id,
      customer_id: s.customerId,
      payment_method_id: s.paymentMethodId,
      plan: s.plan,
      status: s.status,
      trial_ends_at: s.trialEndsAt,
      current_period_start: s.currentPeriodStart,
      current_period_end: s.currentPeriodEnd,
      next_billing_at: s.nextBillingAt,
      retry_count: s.retryCount,
      canceled_at: s.canceledAt,
      cancel_reason: s.cancelReason,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      latest_invoice: latest ? { id: latest.id, amount: latest.amount, currency: latest.currency, status: latest.status } : null,
    };
  };

  // Raw body: the signature is computed over exact bytes, so it must be checked before any parsing.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: () => true, limit: '64kb' }),
    asyncRoute((req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = container.signatureVerifier.verify(raw, req.header(SIGNATURE_HEADER));
      if (signature !== 'valid') {
        res.status(401).json(errorBody(`${signature}_signature`, 'Webhook signature verification failed'));
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        res.status(400).json(errorBody('malformed_payload', 'Body is not valid JSON'));
        return;
      }
      const parsed = WebhookEventSchema.safeParse(json);
      if (!parsed.success) {
        res.status(400).json(errorBody('invalid_payload', 'Webhook payload failed validation', parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }))));
        return;
      }

      const ack = container.webhooks.handle(parsed.data, raw.toString('utf8'));
      res.status(200).json({ received: true, event_id: ack.eventId, outcome: ack.outcome, ...(ack.reason && { reason: ack.reason }) });
    }),
  );

  app.use(express.json());

  app.post(
    '/subscriptions',
    asyncRoute(async (req, res) => {
      const body = parseBody(CreateSubscriptionBody, req.body);
      const created = await service.create({ customerId: body.customer_id, plan: body.plan, paymentMethodId: body.payment_method_id });
      res.status(201).json(serializeSubscription(created));
    }),
  );

  app.get('/subscriptions/:id', asyncRoute((req, res) => void res.json(serializeSubscription(service.get(req.params.id)))));

  app.get(
    '/subscriptions/:id/invoices',
    asyncRoute((req, res) => void res.json({ data: service.listInvoices(req.params.id).map(serializeInvoice) })),
  );

  app.post('/subscriptions/:id/cancel', asyncRoute((req, res) => void res.json(serializeSubscription(service.cancel(req.params.id)))));

  app.post(
    '/subscriptions/:id/plan',
    asyncRoute((req, res) => {
      const body = parseBody(ChangePlanBody, req.body);
      res.json(serializeSubscription(service.changePlan(req.params.id, body.plan)));
    }),
  );

  // Stand-in for the scheduled billing job.
  app.post(
    '/internal/billing/run',
    asyncRoute(async (_req, res) => {
      const results = await container.billing.runDue();
      res.json({
        results: results.map((r: BillingResult) => ({
          subscription_id: r.subscriptionId,
          invoice_id: r.invoiceId,
          outcome: r.outcome,
          ...(r.reason && { reason: r.reason }),
        })),
      });
    }),
  );

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    if (error instanceof AppError) {
      res.status(error.httpStatus).json(errorBody(error.code, error.message, error.details));
      return;
    }
    if (error?.type === 'entity.parse.failed') {
      res.status(400).json(errorBody('malformed_json', 'Request body is not valid JSON'));
      return;
    }
    res.status(500).json(errorBody('internal_error', 'Unexpected error'));
  };
  app.use(errorHandler);

  return app;
}
