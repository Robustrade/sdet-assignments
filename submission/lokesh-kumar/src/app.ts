import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { PLANS } from './domain/plans.js';
import type { Subscription } from './domain/types.js';
import { ApiError } from './errors.js';
import type { SubscriptionService } from './SubscriptionService.js';
import { parseWebhookPayload } from './webhook/payload.js';
import { verifySignature } from './webhook/signature.js';

export const SIGNATURE_HEADER = 'X-Provider-Signature';

function toApi(subscription: Subscription) {
  const plan = PLANS[subscription.plan];
  return {
    id: subscription.id,
    customer_id: subscription.customerId,
    plan: subscription.plan,
    status: subscription.status,
    price: plan.priceCents,
    currency: plan.currency,
    trial_ends_at: subscription.trialEndsAt,
    created_at: subscription.createdAt,
    updated_at: subscription.updatedAt,
  };
}

/** The raw request body as text (empty string when there is none). */
function rawBody(req: Request): string {
  return typeof req.body === 'string' ? req.body : '';
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'invalid_json', 'request body is not valid JSON');
  }
}

/**
 * Builds the Express app. It is returned, not started: tests drive it in-process with
 * supertest, so there is no port to manage and every test gets its own isolated instance.
 */
export function createApp(service: SubscriptionService, webhookSecret: string): Express {
  const app = express();
  app.disable('x-powered-by');
  // Keep every body as raw text: the webhook signature is computed over the exact bytes,
  // and JSON errors are reported by us, with our own error format.
  app.use(express.text({ type: () => true }));

  app.post('/subscriptions', async (req, res) => {
    const created = await service.createSubscription(parseJson(rawBody(req)));
    res.status(201).json(toApi(created));
  });

  app.get('/subscriptions/:id', (req, res) => {
    res.json(toApi(service.getSubscription(req.params.id)));
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    res.json(toApi(service.cancelSubscription(req.params.id)));
  });

  // Test hook (not a public API): runs one billing attempt so tests control "time".
  app.post('/internal/subscriptions/:id/bill', async (req, res) => {
    const result = await service.runBilling(req.params.id);
    res.json({
      subscription: toApi(result.subscription),
      invoice: { id: result.invoice.id, status: result.invoice.status, amount: result.invoice.amount },
    });
  });

  app.post('/webhooks/payment-provider', (req, res) => {
    const raw = rawBody(req);
    // 1. Authenticity first, over the raw bytes. Nothing else is looked at if it fails.
    if (!verifySignature(raw, req.get(SIGNATURE_HEADER), webhookSecret)) {
      throw new ApiError(401, 'invalid_signature', 'webhook signature is missing or invalid');
    }
    // 2. Shape. 3. Business rules.
    const payload = parseWebhookPayload(parseJson(raw));
    res.json(service.handleWebhook(payload));
  });

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `${req.method} ${req.path} does not exist` } });
  });

  // Express recognises an error handler by its four parameters.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'unexpected error' } });
  });

  return app;
}
