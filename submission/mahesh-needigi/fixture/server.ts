import express, { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { BillingDatabase } from './database.js';
import { PlanStrategyResolver } from './PlanStrategy.js';
import { InvalidTransitionError, LifecycleEvent, SubscriptionState, SubscriptionStateMachine } from './SubscriptionStateMachine.js';
import { PaymentGateway } from './PaymentGateway.js';

export const WEBHOOK_SECRET = 'whsec_kulu_test_secret_2026';

export class BillingService {
  readonly app: Express; 
  readonly database: BillingDatabase;
  readonly paymentGateway: PaymentGateway;
  readonly planResolver: PlanStrategyResolver;
  readonly stateMachine: SubscriptionStateMachine;
  readonly validCustomers = ['cust_001', 'cust_002', 'cust_vip'];

  constructor(database: BillingDatabase, paymentGateway: PaymentGateway) {
    this.app = express();
    this.database = database;
    this.paymentGateway = paymentGateway;
    this.planResolver = new PlanStrategyResolver();
    this.stateMachine = new SubscriptionStateMachine();
    this.setupRoutes();
  }

  private logAudit(subId: string, fromState: string, toState: string, trigger: string): void {
    this.database.db.prepare('INSERT INTO audit_history (subscription_id, from_state, to_state, trigger) VALUES (?, ?, ?, ?)').run(subId, fromState, toState, trigger);
  }

  private recordWebhook(eventId: string, subId: string, type: string, result: string, invoiceAmount?: number, invoiceStatus?: string, invoiceId?: string): void {
    this.database.db.prepare('INSERT OR IGNORE INTO webhook_events VALUES (?, ?, ?, ?)').run(eventId, subId, type, result);
    if (invoiceStatus && invoiceAmount !== undefined) {
      this.database.db.prepare('INSERT INTO invoices VALUES (?, ?, ?, ?, ?)').run(invoiceId || `inv_${eventId}`, subId, invoiceAmount, 'USD', invoiceStatus);
    }
  }

  setupRoutes(): void {
    const db = this.database.db;

    this.app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
    this.app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      if (err instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON' });
      next(err);
    });

    // 1. Create Subscription
    this.app.post('/subscriptions', async (req: Request, res: Response) => {
      const { customer_id, plan, payment_method_id } = req.body || {};
      if (!customer_id || !plan || !payment_method_id) return res.status(400).json({ error: 'Missing required fields' });
      if (!this.validCustomers.includes(customer_id)) return res.status(404).json({ error: 'Unknown customer' });

      let config;
      try { config = this.planResolver.resolve(plan).getConfig(); }
      catch (e: any) { return res.status(400).json({ error: e.message }); }

      const subId = `sub_${crypto.randomBytes(4).toString('hex')}`;
      let status = config.chargeImmediately ? SubscriptionState.ACTIVE : SubscriptionState.TRIALING;
      let failedAttempts = 0;

      if (config.chargeImmediately) {
        try {
          const charge = await this.paymentGateway.charge({ customerId: customer_id, amount: config.priceCents, currency: 'USD', paymentMethodId: payment_method_id });
          const paid = charge.status === 'succeeded';
          status = paid ? SubscriptionState.ACTIVE : SubscriptionState.PAST_DUE;
          failedAttempts = paid ? 0 : 1;
          db.prepare('INSERT INTO invoices VALUES (?, ?, ?, ?, ?)').run(`inv_${crypto.randomBytes(3).toString('hex')}`, subId, config.priceCents, 'USD', paid ? 'paid' : 'failed');
        } catch {
          return res.status(504).json({ error: 'Payment gateway timeout' });
        }
      }

      db.prepare('INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(subId, customer_id, config.name, payment_method_id, status, config.trialDays, config.priceCents, failedAttempts);
      this.logAudit(subId, 'none', status, 'api.create');
      return res.status(201).json({ id: subId, customer_id, plan: config.name, status, trial_days: config.trialDays, price_cents: config.priceCents });
    });

    // 2. Get Subscription
    this.app.get('/subscriptions/:id', (req: Request, res: Response) => {
      const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
      return sub ? res.json(sub) : res.status(404).json({ error: 'Subscription not found' });
    });

    // 3. Cancel Subscription
    this.app.post('/subscriptions/:id/cancel', (req: Request, res: Response) => {
      const sub: any = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      try {
        const nextState = this.stateMachine.transition(sub.status, LifecycleEvent.CANCEL);
        db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(nextState, sub.id);
        this.logAudit(sub.id, sub.status, nextState, 'api.cancel');
        return res.json({ ...sub, status: nextState });
      } catch (e: any) {
        return res.status(409).json({ error: e.message });
      }
    });

    // 4. Inbound Webhook
    this.app.post('/webhooks/payment-provider', (req: any, res: Response) => {
      const sig = req.header('X-Provider-Signature');
      const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.rawBody || '').digest('hex');
      if (!sig || sig !== expected) return res.status(401).json({ error: 'Invalid signature' });

      const { event_id, type, subscription_id, invoice_id, amount } = req.body || {};
      if (!event_id || !type || !subscription_id) return res.status(400).json({ error: 'Malformed webhook payload' });

      if (db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(event_id)) {
        this.recordWebhook(`${event_id}_dup_${Date.now()}`, subscription_id, type, 'IGNORED_DUPLICATE');
        return res.status(200).json({ status: 'ignored_duplicate' });
      }

      const sub: any = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscription_id);
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });

      const curr = sub.status as SubscriptionState;
      try {
        if (type === 'payment.succeeded') {
          const ev = curr === SubscriptionState.TRIALING ? LifecycleEvent.FIRST_CHARGE_SUCCEEDED : LifecycleEvent.RETRY_CHARGE_SUCCEEDED;
          const next = this.stateMachine.transition(curr, ev);
          db.prepare('UPDATE subscriptions SET status = ?, failed_attempts = 0 WHERE id = ?').run(next, sub.id);
          this.recordWebhook(event_id, sub.id, type, 'PROCESSED', amount ?? sub.price_cents, 'paid', invoice_id);
          this.logAudit(sub.id, curr, next, `webhook.${type}`);
          return res.json({ status: 'processed', subscription_status: next });
        }

        if (type === 'payment.failed') {
          if (invoice_id && db.prepare("SELECT 1 FROM invoices WHERE id = ? AND status = 'paid'").get(invoice_id)) {
            this.recordWebhook(event_id, sub.id, type, 'IGNORED_STALE_EVENT');
            return res.status(200).json({ status: 'ignored_stale_event' });
          }

          const attempts = sub.failed_attempts + 1;
          const ev = curr === SubscriptionState.TRIALING
            ? LifecycleEvent.FIRST_CHARGE_FAILED
            : (curr === SubscriptionState.PAST_DUE && attempts >= 3 ? LifecycleEvent.RETRIES_EXHAUSTED : LifecycleEvent.RECURRING_CHARGE_FAILED);
          const next = (curr === SubscriptionState.PAST_DUE && attempts < 3)
            ? SubscriptionState.PAST_DUE
            : this.stateMachine.transition(curr, ev);

          db.prepare('UPDATE subscriptions SET status = ?, failed_attempts = ? WHERE id = ?').run(next, attempts, sub.id);
          this.recordWebhook(event_id, sub.id, type, 'PROCESSED', amount ?? sub.price_cents, 'failed', invoice_id);
          this.logAudit(sub.id, curr, next, `webhook.${type}`);
          return res.json({ status: 'processed', subscription_status: next });
        }

        if (type === 'payment.refunded') {
          if (curr !== SubscriptionState.ACTIVE) throw new InvalidTransitionError(curr, LifecycleEvent.CANCEL);
          this.recordWebhook(event_id, sub.id, type, 'PROCESSED', -Math.abs(amount ?? sub.price_cents), 'refunded', invoice_id);
          this.logAudit(sub.id, curr, curr, `webhook.${type}`);
          return res.json({ status: 'processed' });
        }

        return res.status(400).json({ error: 'Unknown event type' });
      } catch (e: any) {
        this.recordWebhook(event_id, sub.id, type, 'REJECTED_INVALID_TRANSITION');
        return res.status(409).json({ error: e.message });
      }
    });
  }
}

export function createBillingApp(database: BillingDatabase, paymentGateway: PaymentGateway): Express {
  return new BillingService(database, paymentGateway).app;
}
