import { Router, Request, Response } from 'express';
import { SubscriptionService } from '../domain/subscription/SubscriptionService';
import { CreateSubscriptionRequest } from '../domain/subscription/types';

export function createSubscriptionRoutes(service: SubscriptionService): Router {
  const router = Router();

  // POST /subscriptions - Create subscription
  router.post('/', async (req: Request, res: Response) => {
    try {
      const request: CreateSubscriptionRequest = req.body;

      // Validation
      if (!request.customer_id) {
        return res.status(400).json({ error: 'customer_id is required' });
      }
      if (!request.plan) {
        return res.status(400).json({ error: 'plan is required' });
      }
      if (!request.payment_method_id) {
        return res.status(400).json({ error: 'payment_method_id is required' });
      }

      const subscription = await service.createSubscription(request);
      res.status(201).json(subscription);
    } catch (error: any) {
      if (error.message?.includes('Invalid plan')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // GET /subscriptions/:id - Get subscription
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const subscription = await service.getSubscription(req.params.id);
      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      res.status(200).json(subscription);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /subscriptions/:id/cancel - Cancel subscription
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const subscription = await service.cancelSubscription(req.params.id);
      res.status(200).json(subscription);
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
