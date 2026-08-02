import express from 'express';
import { DB } from '../infrastructure/Database';
import { PaymentProvider } from '../infrastructure/PaymentProvider';
import { Subscription } from '../domain/Subscription';
import { isValidPlan, PLANS, PlanTier } from '../domain/Plan';
import { createWebhookSignature } from './signature';

const KNOWN_CUSTOMERS = new Set(['cust_001', 'cust_002']);
const KNOWN_PAYMENT_METHODS = new Set(['pm_test', 'pm_test_visa_4242']);

export function createApp(db: DB, paymentProvider: PaymentProvider) {
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

      const subId = `sub_${Date.now()}`;
      const planConfig = PLANS[plan as PlanTier];
      const initialState: 'trialing' | 'active' = planConfig.trialDays > 0 ? 'trialing' : 'active';
      
      const sub = new Subscription(subId, customer_id, plan as PlanTier, initialState);
      db.saveSubscription(sub);
      db.logSubscriptionEvent(`evt_create_${subId}`, sub.id, 'subscription.created', JSON.stringify({ plan, state: sub.state }));

      if (initialState === 'active') {
        try {
          const chargeRes = await paymentProvider.charge({
            amount: planConfig.price,
            currency: 'USD',
            customerId: customer_id,
            paymentMethodId: payment_method_id,
            idempotencyKey: `charge_init_${subId}`
          });

          if (!chargeRes.success) {
            sub.paymentFailed();
            db.saveSubscription(sub);
            const invId = `inv_${Date.now()}`;
            db.saveInvoice(invId, sub.id, planConfig.price, 'failed', 'charge');
            db.logSubscriptionEvent(`evt_charge_failed_${invId}`, sub.id, 'payment.failed', JSON.stringify({ invoiceId: invId }));
            return res.status(402).json({ error: 'Payment failed', subscription: sub });
          }

          const invId = `inv_${Date.now()}`;
          db.saveInvoice(invId, sub.id, planConfig.price, 'paid', 'charge');
          db.logSubscriptionEvent(`evt_charge_succeeded_${invId}`, sub.id, 'payment.succeeded', JSON.stringify({ invoiceId: invId }));
        } catch (chargeError: any) {
          sub.paymentFailed();
          db.saveSubscription(sub);
          const invId = `inv_${Date.now()}`;
          db.saveInvoice(invId, sub.id, planConfig.price, 'failed', 'timeout');
          db.logSubscriptionEvent(`evt_charge_timeout_${invId}`, sub.id, 'payment.timeout', JSON.stringify({ invoiceId: invId }));
          return res.status(502).json({ error: 'Payment provider timeout', subscription: sub });
        }
      }

      res.status(201).json(sub);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/subscriptions/:id', (req, res) => {
    const sub = db.getSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    res.json(sub);
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    const sub = db.getSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    
    try {
      sub.cancel();
      db.saveSubscription(sub);
      db.logSubscriptionEvent(`evt_cancel_${sub.id}`, sub.id, 'subscription.canceled', JSON.stringify({ state: sub.state }));
      res.json(sub);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/subscriptions/:id/change-plan', (req, res) => {
    const sub = db.getSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });

    const { plan } = req.body;
    if (!plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidPlan(plan)) {
      return res.status(400).json({ error: 'Unknown plan' });
    }

    try {
      sub.changePlan(plan as PlanTier);
      db.saveSubscription(sub);
      db.logSubscriptionEvent(`evt_change_plan_${sub.id}`, sub.id, 'subscription.plan_changed', JSON.stringify({ plan: sub.plan }));
      res.json(sub);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/webhooks/payment-provider', (req, res) => {
    const signature = req.headers['x-provider-signature'];
    const rawBody = (req as any).rawBody as string | undefined;

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }
    if (!rawBody || createWebhookSignature(rawBody) !== String(signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { event_id, type, subscription_id, invoice_id, amount } = req.body;
    if (!event_id || !type || !subscription_id || !invoice_id || typeof amount !== 'number') {
       return res.status(400).json({ error: 'Malformed payload' });
    }

    if (db.isEventProcessed(event_id)) {
      return res.status(200).json({ status: 'ignored_duplicate' });
    }

    const sub = db.getSubscription(subscription_id);
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    try {
      const existingInvoice = db.getInvoice(invoice_id) as { status?: string } | null;
      if (existingInvoice && existingInvoice.status === 'paid' && type === 'payment.failed') {
        db.markEventProcessed(event_id);
        return res.status(200).json({ status: 'ignored_invalid_transition', reason: 'Stale failed payment after paid invoice' });
      }

      if (type === 'payment.succeeded') {
        sub.paymentSucceeded();
        db.saveInvoice(invoice_id, sub.id, amount, 'paid', 'webhook');
        db.logSubscriptionEvent(event_id, sub.id, 'payment.succeeded', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.failed') {
        sub.paymentFailed();
        db.saveInvoice(invoice_id, sub.id, amount, 'failed', 'webhook');
        db.logSubscriptionEvent(event_id, sub.id, 'payment.failed', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.refunded') {
        sub.paymentRefunded();
        db.saveInvoice(invoice_id, sub.id, amount, 'refunded', 'webhook');
        db.logSubscriptionEvent(event_id, sub.id, 'payment.refunded', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.retry_exhausted') {
        sub.expireRetries();
        db.saveInvoice(invoice_id, sub.id, amount, 'failed', 'webhook');
        db.logSubscriptionEvent(event_id, sub.id, 'payment.retry_exhausted', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else {
        return res.status(400).json({ error: 'Unknown event type' });
      }
      db.saveSubscription(sub);
      db.markEventProcessed(event_id);
      res.status(200).json({ status: 'processed' });
    } catch (err: any) {
      db.markEventProcessed(event_id);
      res.status(200).json({ status: 'ignored_invalid_transition', reason: err.message });
    }
  });

  return app;
}
