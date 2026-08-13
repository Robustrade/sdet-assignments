import { Router, raw } from 'express';
import type { WebhookService } from '../services/WebhookService.js';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';

export function createWebhooksRouter(service: WebhookService): Router {
  const router = Router();

  router.post(
    '/payment-provider',
    raw({ type: ['application/json', 'application/*+json', 'text/plain'], limit: '1mb' }),
    async (req, res) => {
      try {
        const rawBody = req.body as Buffer;
        const signature = req.header('x-provider-signature');
        const result = await service.process(rawBody.toString('utf8'), signature);
        res.json({ status: 'ok', outcome: result.outcome });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          res.status(401).json({ error: err.message });
          return;
        }
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  return router;
}