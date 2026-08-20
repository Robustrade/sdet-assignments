import express, { Express, Request, Response } from 'express';
import {
  SubscriptionService,
  UnknownPlanError,
  SubscriptionNotFoundError,
  ValidationError,
} from '../service/SubscriptionService';
import { SubscriptionRepository, InvoiceRepository, WebhookEventRepository } from '../service/Repository';
import { PaymentProvider } from '../domain/PaymentProvider';
import { InvalidTransitionError } from '../domain/SubscriptionState';
import { verifySignature } from './webhookSignature';

export interface Repos {
  subs: SubscriptionRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
}

export function buildApp(provider: PaymentProvider, repos?: Repos) {
  const resolvedRepos: Repos = repos ?? {
    subs: new SubscriptionRepository(),
    invoices: new InvoiceRepository(),
    webhookEvents: new WebhookEventRepository(),
  };
  const service = new SubscriptionService(resolvedRepos.subs, resolvedRepos.invoices, resolvedRepos.webhookEvents, provider);
  const app: Express = express();

  // Webhook route needs the raw body for signature verification, so it gets
  // its own raw parser instead of the JSON parser used everywhere else.
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: '*/*' }),
    async (req: Request, res: Response) => {
      const rawBody = (req.body as Buffer).toString('utf8');
      const signature = req.header('X-Provider-Signature');

      if (!verifySignature(rawBody, signature)) {
        return res.status(400).json({ error: 'invalid_signature' });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'malformed_payload' });
      }

      try {
        const result = await service.handleWebhook(payload);
        return res.status(200).json(result);
      } catch (err) {
        if (err instanceof SubscriptionNotFoundError) return res.status(404).json({ error: 'not_found' });
        throw err;
      }
    },
  );

  app.use(express.json());

  app.post('/subscriptions', async (req: Request, res: Response) => {
    try {
      const sub = await service.createSubscription(req.body);
      return res.status(201).json(sub);
    } catch (err) {
      if (err instanceof UnknownPlanError || err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    try {
      return res.json(service.getSubscription(req.params.id));
    } catch (err) {
      if (err instanceof SubscriptionNotFoundError) return res.status(404).json({ error: 'not_found' });
      throw err;
    }
  });

  app.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
    try {
      const sub = await service.cancelSubscription(req.params.id);
      return res.json(sub);
    } catch (err) {
      if (err instanceof SubscriptionNotFoundError) return res.status(404).json({ error: 'not_found' });
      if (err instanceof InvalidTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  // Trial-end simulation endpoint - lets tests trigger the first billing
  // attempt without waiting on real time.
  app.post('/subscriptions/:id/simulate-trial-end', async (req: Request, res: Response) => {
    try {
      const sub = await service.triggerTrialEnd(req.params.id);
      return res.json(sub);
    } catch (err) {
      if (err instanceof SubscriptionNotFoundError) return res.status(404).json({ error: 'not_found' });
      if (err instanceof Error && err.message === 'provider_timeout') {
        return res.status(502).json({ error: 'provider_timeout' });
      }
      throw err;
    }
  });

  return { app, service, repos: resolvedRepos };
}
