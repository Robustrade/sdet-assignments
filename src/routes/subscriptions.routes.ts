import { Router, json } from 'express';
import type { SubscriptionService } from '../services/SubscriptionService.js';
import type { Subscription } from '../domain/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';

function toApi(subscription: Subscription): Record<string, unknown> {
  return {
    id: subscription.id,
    customer_id: subscription.customerId,
    plan: subscription.plan,
    status: subscription.state,
    payment_method_id: subscription.paymentMethodId,
    created_at: subscription.createdAt,
    updated_at: subscription.updatedAt,
  };
}

export function createSubscriptionsRouter(
  service: SubscriptionService,
): Router {
  const router = Router();
  router.use(json({ limit: '1mb' }));

  router.post('/', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await service.create({
        customerId: typeof body.customer_id === 'string' ? body.customer_id : undefined,
        plan: body.plan as 'basic' | 'pro',
        paymentMethodId:
          typeof body.payment_method_id === 'string' ? body.payment_method_id : undefined,
      });
      res.status(201).json(toApi(result.subscription));
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const id = req.params.id as string;
      res.json(toApi(service.get(id)));
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post('/:id/cancel', (req, res) => {
    try {
      const id = req.params.id as string;
      res.json(toApi(service.cancel(id)));
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}