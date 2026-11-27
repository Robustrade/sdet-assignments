/**
 * Express HTTP router mounting raw-body webhook capture prior to JSON middleware.
 * Author: Vedant Dalkari
 */

import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { DomainError } from '../domain/errors.js';
import type { BillingEngine } from '../services/BillingEngine.js';
import type { SubscriptionService } from '../services/SubscriptionService.js';
import type { WebhookProcessor } from '../services/WebhookProcessor.js';

export interface HttpAppDependencies {
  readonly subscriptionService: SubscriptionService;
  readonly billingEngine: BillingEngine;
  readonly webhookProcessor: WebhookProcessor;
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function createApp(deps: HttpAppDependencies): Express {
  const app = express();

  // Raw UTF-8 buffer capture strictly precedes JSON middleware for HMAC verification.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: '*/*' }),
    asyncRoute(async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8');
      const signatureHeader = req.header('x-provider-signature');
      const result = await deps.webhookProcessor.processWebhook(rawBody, signatureHeader);
      res.status(200).json(result);
    }),
  );

  const jsonParser = express.json();

  app.post(
    '/subscriptions',
    jsonParser,
    asyncRoute(async (req, res) => {
      const created = await deps.subscriptionService.createSubscription(req.body);
      res.status(201).json(created);
    }),
  );

  app.get(
    '/subscriptions/:id',
    asyncRoute(async (req, res) => {
      const subscription = await deps.subscriptionService.getSubscription(req.params.id);
      res.status(200).json(subscription);
    }),
  );

  app.post(
    '/subscriptions/:id/cancel',
    jsonParser,
    asyncRoute(async (req, res) => {
      const canceled = await deps.subscriptionService.cancelSubscription(req.params.id);
      res.status(200).json(canceled);
    }),
  );

  app.post(
    '/billing/run-due',
    jsonParser,
    asyncRoute(async (_req, res) => {
      const result = await deps.billingEngine.runDueBilling();
      res.status(200).json({
        processed_count: result.processedCount,
        subscription_ids: result.subscriptionIds,
      });
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
      });
      return;
    }

    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as { readonly status?: number }).status === 400
    ) {
      res.status(400).json({
        error: 'invalid_json',
        message: 'Malformed JSON request body',
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({
      error: 'internal_error',
      message,
    });
  });

  return app;
}
