import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { BillingRepository, PLANS, SubscriptionLifecycle, type PaymentProvider, type Plan, type Status } from './domain.js';

const SECRET = 'fixture-webhook-secret';
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

export const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

export function createBillingApp(repository: BillingRepository, provider: PaymentProvider) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));

  app.post('/subscriptions', async (req: Request, res: Response) => {
    const { customer_id, plan, payment_method_id } = req.body ?? {};
    if (!customer_id || !plan || !payment_method_id) return res.status(400).json({ error: 'customer_id, plan and payment_method_id are required' });
    if (typeof customer_id !== 'string' || !repository.customers.has(customer_id)) return res.status(404).json({ error: 'Unknown customer' });
    if (!(plan in PLANS)) return res.status(400).json({ error: 'Unknown plan' });
    if (typeof payment_method_id !== 'string' || !payment_method_id.startsWith('pm_')) return res.status(400).json({ error: 'Invalid payment method' });
    const planConfig = PLANS[plan as Plan];
    const subscription = { id: id('sub'), customer_id, plan: plan as Plan, payment_method_id, status: 'trialing' as Status, created_at: now() };
    repository.subscriptions.set(subscription.id, subscription);
    repository.auditEvents.push({ id: id('audit'), subscription_id: subscription.id, from: null, to: 'trialing', reason: `created; trial_days=${planConfig.trialDays}`, created_at: now() });
    // Fixture models trial plans; the first charge is triggered explicitly by a successful/failed provider outcome endpoint.
    return res.status(201).json(subscription);
  });

  app.get('/subscriptions/:id', (req, res) => {
    const subscription = repository.getSubscription(req.params.id as string);
    return subscription ? res.json(subscription) : res.status(404).json({ error: 'Subscription not found' });
  });

  app.post('/subscriptions/:id/cancel', (req, res) => {
    const subscription = repository.getSubscription(req.params.id as string);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    try {
      const from = subscription.status;
      subscription.status = SubscriptionLifecycle.transition(from, 'cancel');
      repository.auditEvents.push({ id: id('audit'), subscription_id: subscription.id, from, to: subscription.status, reason: 'customer_cancel', created_at: now() });
      return res.json(subscription);
    } catch (error) { return res.status(409).json({ error: message(error) }); }
  });

  app.post('/subscriptions/:id/charge', async (req, res) => {
    const subscription = repository.getSubscription(req.params.id as string);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    if (subscription.status === 'canceled') return res.status(409).json({ error: 'Subscription is canceled' });
    const amount = PLANS[subscription.plan].price;
    const invoiceId = id('inv');
    const result = await provider.charge({ customerId: subscription.customer_id, paymentMethodId: subscription.payment_method_id, amount, currency: 'USD', idempotencyKey: invoiceId });
    const outcome = result.outcome === 'success' ? 'success' : 'failure';
    const from = subscription.status;
    if (SubscriptionLifecycle['transition']) {
      try { subscription.status = SubscriptionLifecycle.transition(from, outcome); }
      catch { return res.status(409).json({ error: `Cannot apply ${outcome} to ${from}` }); }
    }
    const paymentStatus = result.outcome === 'success' ? 'succeeded' : result.outcome === 'timeout' ? 'unknown' : 'failed';
    repository.invoices.set(invoiceId, { id: invoiceId, subscription_id: subscription.id, amount, currency: 'USD', status: paymentStatus, provider_reference: result.reference, created_at: now() });
    repository.auditEvents.push({ id: id('audit'), subscription_id: subscription.id, from, to: subscription.status, reason: `charge_${result.outcome}`, created_at: now() });
    return res.status(201).json({ subscription, invoice: repository.invoices.get(invoiceId) });
  });

  app.post('/webhooks/payment-provider', (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header('X-Provider-Signature');
    if (!raw || !signature) return res.status(401).json({ error: 'Missing signature' });
    const expected = Buffer.from(sign(raw.toString('utf8')));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.status(401).json({ error: 'Invalid signature' });
    let event: any;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Malformed JSON' }); }
    if (!event || typeof event.event_id !== 'string' || typeof event.subscription_id !== 'string' || typeof event.invoice_id !== 'string' || !['payment.succeeded', 'payment.failed', 'payment.refunded'].includes(event.type) || typeof event.amount !== 'number' || typeof event.currency !== 'string') return res.status(400).json({ error: 'Invalid webhook payload' });
    if (repository.webhookEvents.has(event.event_id)) {
      repository.webhookEvents.set(`${event.event_id}:duplicate:${id('receipt')}`, { event_id: event.event_id, subscription_id: event.subscription_id, type: event.type, disposition: 'duplicate', received_at: now() });
      return res.json({ received: true, duplicate: true });
    }
    const sub = repository.getSubscription(event.subscription_id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    let disposition: 'processed' | 'ignored' = 'processed';
    const from = sub.status;
    const existing = repository.invoices.get(event.invoice_id);
    const webhookStatus = event.type === 'payment.succeeded' ? 'succeeded' : event.type === 'payment.failed' ? 'failed' : 'refunded';
    if (sub.status === 'canceled' || (existing?.status === 'succeeded' && webhookStatus === 'failed')) disposition = 'ignored';
    else {
      if (webhookStatus !== 'refunded') {
        const trigger = webhookStatus === 'succeeded' ? 'success' : 'failure';
        try { sub.status = SubscriptionLifecycle.transition(sub.status, trigger); }
        catch { disposition = 'ignored'; }
      }
      if (disposition === 'processed') {
        if (!existing || !(existing.status === 'succeeded' && webhookStatus !== 'succeeded')) repository.invoices.set(event.invoice_id, { id: event.invoice_id, subscription_id: sub.id, amount: event.amount, currency: event.currency, status: webhookStatus, provider_reference: event.event_id, created_at: now() });
        repository.auditEvents.push({ id: id('audit'), subscription_id: sub.id, from, to: sub.status, reason: event.type, created_at: now() });
      }
    }
    repository.webhookEvents.set(event.event_id, { event_id: event.event_id, subscription_id: sub.id, type: event.type, disposition, received_at: now() });
    return res.json({ received: true, disposition, subscription: sub });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
  void _next;
  return res.status(400).json({ error: message(error) });
});
  return app;
}
