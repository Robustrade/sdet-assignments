import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { DomainError } from '../domain/errors';
import type { Repositories } from '../persistence/repositories';
import type { BillingCycleRunner } from '../services/billing-cycle-runner';
import type { SignatureVerifier } from '../services/signature-verifier';
import type { SubscriptionService } from '../services/subscription-service';
import { WebhookProcessor } from '../services/webhook-processor';
import { toEventResource, toInvoiceResource, toSubscriptionResource } from './serializers';

export interface AppDeps {
  subscriptions: SubscriptionService;
  webhooks: WebhookProcessor;
  billingRunner: BillingCycleRunner;
  repos: Repositories;
  signatures: SignatureVerifier;
}

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

export function createApp(deps: AppDeps): Express {
  const app = express();

  /**
   * The webhook route takes the body as raw text: the signature covers the exact
   * bytes, so it must be verified before the payload is parsed or trusted.
   */
  app.post(
    '/webhooks/payment-provider',
    express.text({ type: '*/*', limit: '1mb' }),
    (req: Request, res: Response) => {
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const signature = req.get('X-Provider-Signature');

      if (!deps.signatures.verify(rawBody, signature)) {
        res.status(401).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: signature ? 'Webhook signature verification failed' : 'Missing X-Provider-Signature header'
          }
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        res.status(400).json({
          error: { code: 'MALFORMED_PAYLOAD', message: 'Webhook body is not valid JSON' }
        });
        return;
      }

      const event = WebhookProcessor.parse(parsed);
      const result = deps.webhooks.process(event);
      res.status(200).json(result);
    }
  );

  app.use(express.json({ limit: '1mb' }));

  app.post(
    '/subscriptions',
    asyncRoute(async (req, res) => {
      const created = await deps.subscriptions.create(req.body ?? {});
      res.status(201).json(toSubscriptionResource(created));
    })
  );

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    res.status(200).json(toSubscriptionResource(deps.subscriptions.get(req.params.id)));
  });

  app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
    res.status(200).json(toSubscriptionResource(deps.subscriptions.cancel(req.params.id)));
  });

  app.get('/subscriptions/:id/invoices', (req: Request, res: Response) => {
    const sub = deps.subscriptions.get(req.params.id);
    res.status(200).json({ data: deps.repos.invoices.findBySubscription(sub.id).map(toInvoiceResource) });
  });

  app.get('/subscriptions/:id/events', (req: Request, res: Response) => {
    const sub = deps.subscriptions.get(req.params.id);
    res
      .status(200)
      .json({ data: deps.repos.subscriptionEvents.findBySubscription(sub.id).map(toEventResource) });
  });

  app.post(
    '/billing/run-cycle',
    asyncRoute(async (_req, res) => {
      res.status(200).json(await deps.billingRunner.run());
    })
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route' } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details ?? null }
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: 'MALFORMED_PAYLOAD', message: 'Body is not valid JSON' } });
      return;
    }
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'unknown' }
    });
  });

  return app;
}
