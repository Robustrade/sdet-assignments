import express, {
  Express, Request, Response, NextFunction,
} from 'express';
import { SubscriptionService, ValidationError } from '../domain/subscriptionService';
import { verifySignature } from '../webhooks/signature';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

export function buildApp(service: SubscriptionService): Express {
  const app = express();

  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf.toString('utf8');
    },
  }));

  app.post('/subscriptions', async (req: Request, res: Response) => {
    try {
      const sub = await service.createSubscription(req.body);
      res.status(201).json(sub);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.get('/subscriptions/:id', (req: Request, res: Response) => {
    const sub = service.getSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'not_found' });
    res.status(200).json(sub);
  });

  app.post('/subscriptions/:id/cancel', async (req: Request, res: Response) => {
    try {
      const sub = await service.cancelSubscription(req.params.id);
      res.status(200).json(sub);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.post('/webhooks/payment-provider', async (req: RawBodyRequest, res: Response) => {
    const signature = req.header('X-Provider-Signature');
    const rawBody = req.rawBody ?? '';

    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const body = req.body ?? {};
    const requiredFields = ['event_id', 'type', 'subscription_id', 'invoice_id', 'amount', 'currency'];
    const missing = requiredFields.filter((f) => body[f] === undefined || body[f] === null);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'malformed_payload', missing });
    }

    const result = await service.processWebhook(body);
    res.status(200).json({ received: true, noop: result.noop });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'malformed_json' });
    }
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
