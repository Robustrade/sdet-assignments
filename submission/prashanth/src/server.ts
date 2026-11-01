import { createHmac, timingSafeEqual } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import { BillingService, HttpError, WebhookEvent } from './billingService';
import { Database, Invoice, Subscription } from './database';

const toJson = (s: Subscription) => ({
  id: s.id,
  customer_id: s.customerId,
  plan: s.plan,
  status: s.status,
  payment_method_id: s.paymentMethodId,
  trial_ends_at: s.trialEndsAt,
  created_at: s.createdAt,
  canceled_at: s.canceledAt,
});

const invoiceJson = (i: Invoice) => ({
  id: i.id,
  subscription_id: i.subscriptionId,
  amount: i.amount,
  currency: i.currency,
  status: i.status,
  attempt: i.attempt,
  idempotency_key: i.idempotencyKey,
  note: i.note,
});

function validSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const WEBHOOK_FIELDS = ['event_id', 'type', 'subscription_id', 'invoice_id', 'currency'];
const WEBHOOK_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'];

export function createApp(billing: BillingService, db: Database, webhookSecret: string) {
  const app = express();
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

  // Webhook route reads the RAW body: the signature is calculated over the exact bytes.
  app.post('/webhooks/payment-provider', express.raw({ type: '*/*' }), (req, res) => {
    const signature = req.header('X-Provider-Signature');
    if (!signature) return res.status(401).json({ error: 'missing_signature' });
    if (!validSignature(req.body, signature, webhookSecret)) return res.status(401).json({ error: 'invalid_signature' });

    let event: any;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'malformed_json' });
    }
    const missing = WEBHOOK_FIELDS.find((f) => typeof event?.[f] !== 'string' || event[f] === '');
    if (missing) return res.status(400).json({ error: 'invalid_payload', field: missing });
    if (!WEBHOOK_TYPES.includes(event.type)) return res.status(400).json({ error: 'invalid_payload', field: 'type' });
    if (!Number.isInteger(event.amount)) return res.status(400).json({ error: 'invalid_payload', field: 'amount' });

    // Always 200 for valid events (even ignored/duplicate), otherwise the provider retries forever.
    return res.status(200).json(billing.handleWebhook(event as WebhookEvent));
  });

  app.use(express.json());

  app.post('/subscriptions', wrap(async (req, res) => res.status(201).json(toJson(await billing.createSubscription(req.body)))));
  app.get('/subscriptions/:id', wrap((req, res) => res.json(toJson(billing.getSubscription(req.params.id)))));
  app.post('/subscriptions/:id/cancel', wrap((req, res) => res.json(toJson(billing.cancel(req.params.id)))));
  app.get('/subscriptions/:id/invoices', wrap((req, res) => {
    billing.getSubscription(req.params.id);
    res.json(db.invoicesOf(req.params.id).map(invoiceJson));
  }));
  // Stands in for the billing scheduler (trial end, monthly renewal, retry).
  app.post('/subscriptions/:id/charge', wrap(async (req, res) => {
    const r = await billing.chargeNow(req.params.id);
    res.json({ outcome: r.outcome, subscription: toJson(r.subscription), invoice: invoiceJson(r.invoice) });
  }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed_json' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
