import express from 'express';
import { DB } from '../infrastructure/Database';
import { PaymentProvider } from '../infrastructure/PaymentProvider';
import { Subscription } from '../domain/Subscription';
import { isValidPlan, PLANS, PlanTier } from '../domain/Plan';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { SubscriptionService } from '../services/SubscriptionService';
import { createWebhookSignature } from './signature';
import logger from '../utils/logger';

const KNOWN_CUSTOMERS = new Set(['cust_001', 'cust_002']);
const KNOWN_PAYMENT_METHODS = new Set(['pm_test', 'pm_test_visa_4242']);

/**
 * Create and configure the Express application for the subscription API.
 * @param db - Database adapter instance
 * @param paymentProvider - Payment provider adapter (injected for testability)
 */
export function createApp(db: DB, paymentProvider: PaymentProvider) {
  const repo = new SubscriptionRepository(db);
  const service = new SubscriptionService(repo, paymentProvider);

  const app = express();
  app.use(express.json({ verify: (req, res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  }}));

  app.post('/subscriptions', async (req, res) => {
    try {
      const { customer_id, plan, payment_method_id } = req.body;

      if (!customer_id || !plan || !payment_method_id) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!isValidPlan(plan)) {
        return res.status(400).json({ error: 'Unknown plan' });
      }

      if (!KNOWN_CUSTOMERS.has(customer_id)) {
        return res.status(400).json({ error: 'Unknown customer' });
      }

      if (!KNOWN_PAYMENT_METHODS.has(payment_method_id)) {
        return res.status(400).json({ error: 'Invalid payment method' });
      }

      logger.info('createSubscription request', { customer_id, plan });
      const result = await service.createSubscription(customer_id, plan as PlanTier, payment_method_id);
      if (result.error) {
        return res.status(result.statusCode || 400).json({ error: result.error, subscription: result.subscription });
      }
      res.status(result.statusCode || 201).json(result.subscription);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/subscriptions/:id', (req, res) => {
    const sub = repo.get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    res.json(sub);
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    try {
      const sub = service.cancel(req.params.id);
      res.json(sub);
    } catch (err: any) {
      if (err.message === 'Not found') return res.status(404).json({ error: 'Not found' });
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/subscriptions/:id/change-plan', (req, res) => {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: 'Missing required fields' });
    if (!isValidPlan(plan)) return res.status(400).json({ error: 'Unknown plan' });

    try {
      service.changePlan(req.params.id, plan as PlanTier);
      const updated = repo.get(req.params.id);
      res.json(updated);
    } catch (err: any) {
      if (err.message === 'Not found') return res.status(404).json({ error: 'Not found' });
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/webhooks/payment-provider', async (req, res) => {
    const signature = req.headers['x-provider-signature'];
    const rawBody = (req as any).rawBody as string | undefined;

    if (!signature) {
      logger.warn('missing webhook signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    if (!rawBody || createWebhookSignature(rawBody) !== String(signature)) {
      logger.warn('invalid webhook signature', { signature });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { event_id } = req.body;
    if (!event_id) return res.status(400).json({ error: 'Malformed payload' });

    const result = await service.handleWebhook(req.body);
    if ((result as any).error) return res.status((result as any).statusCode || 400).json(result);
    return res.status(200).json(result);
  });

  return app;
}
