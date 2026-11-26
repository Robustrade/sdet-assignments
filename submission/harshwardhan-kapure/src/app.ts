import express, { Express, Request, Response } from 'express';
import { BillingService, PaymentProviderError } from './billingService';
import { PaymentProvider } from './paymentProvider';
import { getPlanStrategy } from './plans';
import { SubscriptionRepository } from './repository';
import { DEFAULT_WEBHOOK_SECRET, verifyWebhookSignature } from './signature';
import { InvalidTransitionError } from './stateMachine';
import { WebhookEventType, WebhookPayload } from './types';

export interface AppDependencies {
  repository: SubscriptionRepository;
  paymentProvider: PaymentProvider;
  webhookSecret?: string;
  maxRetries?: number;
}

const VALID_WEBHOOK_TYPES = new Set<WebhookEventType>([
  'payment.succeeded',
  'payment.failed',
  'payment.refunded'
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseWebhookPayload(rawBody: Buffer): WebhookPayload | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { error: 'Malformed JSON payload' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Webhook payload must be a JSON object' };
  }

  const body = parsed as Record<string, unknown>;
  if (
    !isNonEmptyString(body.event_id) ||
    !isNonEmptyString(body.type) ||
    !VALID_WEBHOOK_TYPES.has(body.type as WebhookEventType) ||
    !isNonEmptyString(body.subscription_id) ||
    !isNonEmptyString(body.invoice_id) ||
    typeof body.amount !== 'number' ||
    !Number.isInteger(body.amount) ||
    body.amount <= 0 ||
    !isNonEmptyString(body.currency)
  ) {
    return { error: 'Missing or invalid required webhook fields' };
  }

  return {
    event_id: body.event_id,
    type: body.type as WebhookEventType,
    subscription_id: body.subscription_id,
    invoice_id: body.invoice_id,
    amount: body.amount,
    currency: body.currency
  };
}

/**
 * Factory creating the Subscription & Billing Express application with injected dependencies.
 */
export function createApp(deps: AppDependencies): Express {
  const {
    repository,
    paymentProvider,
    webhookSecret = DEFAULT_WEBHOOK_SECRET,
    maxRetries = 3
  } = deps;
  const billing = new BillingService(repository, paymentProvider, maxRetries);
  const app = express();

  // Verify HMAC-SHA256 over exact raw request bytes before JSON parsing or business logic.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: '*/*' }),
    (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : '');
      const signature = req.header('X-Provider-Signature');

      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        res.status(401).json({ error: 'Invalid or missing signature' });
        return;
      }

      const parsed = parseWebhookPayload(rawBody);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const payload = parsed;
      if (repository.hasProcessedOrSeenWebhook(payload.event_id)) {
        billing.recordWebhook(payload, 'duplicate', 'Duplicate event_id ignored');
        res.status(200).json({ status: 'duplicate', event_id: payload.event_id });
        return;
      }

      const sub = repository.findSubscriptionById(payload.subscription_id);
      if (!sub) {
        billing.recordWebhook(payload, 'ignored', 'Subscription not found');
        res.status(200).json({
          status: 'ignored',
          event_id: payload.event_id,
          reason: 'Subscription not found'
        });
        return;
      }

      if (payload.type === 'payment.succeeded') {
        if (sub.status === 'canceled') {
          billing.recordWebhook(payload, 'ignored', 'Cannot reactivate canceled subscription');
          res.status(200).json({
            status: 'ignored',
            event_id: payload.event_id,
            reason: 'Subscription is canceled'
          });
          return;
        }

        billing.upsertWebhookInvoice(payload, sub.customer_id, 'paid');
        billing.applyPaymentSuccess(sub, 'WEBHOOK');
        billing.recordWebhook(payload, 'processed');
        res.status(200).json({ status: 'processed', event_id: payload.event_id });
        return;
      }

      if (payload.type === 'payment.failed') {
        const existingInvoice = repository.findInvoiceById(payload.invoice_id);
        if (existingInvoice?.status === 'paid') {
          billing.recordWebhook(payload, 'ignored', 'Stale payment.failed for already-paid invoice');
          res.status(200).json({
            status: 'ignored',
            event_id: payload.event_id,
            reason: 'Invoice already paid'
          });
          return;
        }

        if (sub.status === 'canceled') {
          billing.recordWebhook(payload, 'ignored', 'Subscription is canceled');
          res.status(200).json({
            status: 'ignored',
            event_id: payload.event_id,
            reason: 'Subscription is canceled'
          });
          return;
        }

        billing.upsertWebhookInvoice(payload, sub.customer_id, 'failed');
        billing.applyPaymentFailure(sub, 'WEBHOOK');
        billing.recordWebhook(payload, 'processed');
        res.status(200).json({ status: 'processed', event_id: payload.event_id });
        return;
      }

      // payment.refunded: only paid invoices can transition to refunded
      const targetInvoice = repository.findInvoiceById(payload.invoice_id);
      if (!targetInvoice || targetInvoice.subscription_id !== sub.id || targetInvoice.status !== 'paid') {
        billing.recordWebhook(payload, 'ignored', 'Invoice not eligible for refund');
        res.status(200).json({
          status: 'ignored',
          event_id: payload.event_id,
          reason: 'Invoice not eligible for refund'
        });
        return;
      }

      billing.upsertWebhookInvoice(payload, sub.customer_id, 'refunded');
      billing.recordWebhook(payload, 'processed');
      res.status(200).json({ status: 'processed', event_id: payload.event_id });
    }
  );

  app.use(express.json());

  app.post('/subscriptions', async (req: Request, res: Response) => {
    const { customer_id, plan, payment_method_id } = req.body ?? {};
    if (!isNonEmptyString(customer_id) || !isNonEmptyString(plan) || !isNonEmptyString(payment_method_id)) {
      res.status(400).json({ error: 'customer_id, plan, and payment_method_id are required' });
      return;
    }

    const planStrategy = getPlanStrategy(plan);
    if (!planStrategy) {
      res.status(400).json({ error: `Unknown plan '${plan}'` });
      return;
    }

    const customer = repository.findCustomerById(customer_id);
    if (!customer) {
      res.status(404).json({ error: `Customer '${customer_id}' not found` });
      return;
    }

    if (!customer.payment_methods.includes(payment_method_id)) {
      res.status(400).json({ error: `Invalid payment_method_id '${payment_method_id}' for customer` });
      return;
    }

    const idempotencyKey = req.header('Idempotency-Key');
    const fingerprint = JSON.stringify({ customer_id, plan, payment_method_id });
    if (isNonEmptyString(idempotencyKey)) {
      const existing = repository.findIdempotencyRecord(idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          res.status(409).json({ error: 'Idempotency-Key reused with different request parameters' });
          return;
        }
        res.status(existing.status_code).json(existing.response_body);
        return;
      }
    }

    let subscription = billing.createInitialSubscription({
      customerId: customer_id,
      plan: planStrategy,
      paymentMethodId: payment_method_id
    });

    if (planStrategy.shouldChargeOnCreation()) {
      try {
        const result = await billing.executeCharge(subscription, planStrategy);
        subscription = result.subscription;
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          res.status(502).json({
            error: err.message,
            subscription: err.subscription,
            invoice: err.invoice
          });
          return;
        }
        throw err;
      }
    }

    if (isNonEmptyString(idempotencyKey)) {
      repository.saveIdempotencyRecord({
        key: idempotencyKey,
        request_fingerprint: fingerprint,
        status_code: 201,
        response_body: subscription,
        created_at: new Date().toISOString()
      });
    }

    res.status(201).json(subscription);
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    const sub = repository.findSubscriptionById(req.params.id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.status(200).json(sub);
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    const sub = repository.findSubscriptionById(req.params.id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    try {
      const updated = billing.transitionSubscription(sub, 'CANCEL', 'API_CANCEL');
      res.status(200).json(updated);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  app.post('/subscriptions/:id/bill', async (req: Request, res: Response) => {
    const sub = repository.findSubscriptionById(req.params.id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    if (sub.status === 'canceled') {
      res.status(409).json({ error: 'Cannot bill a canceled subscription' });
      return;
    }

    const planStrategy = getPlanStrategy(sub.plan);
    if (!planStrategy) {
      res.status(400).json({ error: `Unknown plan '${sub.plan}'` });
      return;
    }

    try {
      const result = await billing.executeCharge(sub, planStrategy);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof PaymentProviderError) {
        res.status(502).json({
          error: err.message,
          subscription: err.subscription,
          invoice: err.invoice
        });
        return;
      }
      throw err;
    }
  });

  return app;
}
