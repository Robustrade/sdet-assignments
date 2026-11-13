import express, { Express, Request, Response } from 'express';
import { InMemoryRepository } from '../persistence/repository';
import { IPaymentProvider } from '../payment/payment-provider.interface';
import { PLANS } from '../domain/plan';
import { SubscriptionStateMachine, SubscriptionStatus } from '../domain/state-machine';
import { randomUUID } from 'crypto';

export function createServer(repository: InMemoryRepository, paymentProvider: IPaymentProvider): Express {
  const app = express();
  app.use(express.json());

  // 1. Create Subscription
  app.post('/subscriptions', async (req: Request, res: Response): Promise<void> => {
    const { customer_id, plan, payment_method_id } = req.body;

    if (!customer_id || !plan || !payment_method_id) {
      res.status(400).json({ error: 'Missing required fields: customer_id, plan, payment_method_id' });
      return;
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      res.status(400).json({ error: `Unknown plan: ${plan}` });
      return;
    }

    const subId = `sub_${randomUUID().substring(0, 8)}`;
    const initialStatus: SubscriptionStatus = planConfig.trialDays > 0 ? 'trialing' : 'active';

    const subRecord: {
      id: string;
      customerId: string;
      plan: string;
      status: SubscriptionStatus;
      paymentMethodId: string;
      createdAt: Date;
    } = {
      id: subId,
      customerId: customer_id,
      plan,
      status: initialStatus,
      paymentMethodId: payment_method_id,
      createdAt: new Date(),
    };

    repository.saveSubscription(subRecord);

    // If no trial, attempt immediate charge
    if (initialStatus === 'active') {
      try {
        const chargeRes = await paymentProvider.charge({
          amount: planConfig.price,
          currency: planConfig.currency,
          customerId: customer_id,
          paymentMethodId: payment_method_id,
        });

        repository.saveInvoice({
          id: chargeRes.invoiceId,
          subscriptionId: subId,
          amount: planConfig.price,
          currency: planConfig.currency,
          status: chargeRes.success ? 'paid' : 'failed',
          createdAt: new Date(),
        });

        if (!chargeRes.success) {
          subRecord.status = SubscriptionStateMachine.transition(subRecord.status, 'past_due');
          repository.saveSubscription(subRecord);
        }
      } catch (err) {
        subRecord.status = SubscriptionStateMachine.transition(subRecord.status, 'past_due');
        repository.saveSubscription(subRecord);
      }
    }

    res.status(201).json(subRecord);
  });

  // 2. Get Subscription
  app.get('/subscriptions/:id', (req: Request, res: Response): void => {
    const sub = repository.getSubscription(req.params.id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.json(sub);
  });

  // 3. Cancel Subscription
  app.post('/subscriptions/:id/cancel', (req: Request, res: Response): void => {
    const sub = repository.getSubscription(req.params.id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    try {
      sub.status = SubscriptionStateMachine.transition(sub.status, 'canceled');
      repository.saveSubscription(sub);
      res.json(sub);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4. Webhook Ingest Endpoint with Idempotency & State transitions
  app.post('/webhooks/payment-provider', async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-provider-signature'];
    if (!signature || signature !== 'valid_hmac_signature') {
      res.status(401).json({ error: 'Invalid or missing provider signature' });
      return;
    }

    const { event_id, type, subscription_id, invoice_id, amount, currency } = req.body;
    if (!event_id || !type || !subscription_id) {
      res.status(400).json({ error: 'Malformed webhook payload' });
      return;
    }

    // Idempotency check
    if (repository.hasProcessedEvent(event_id)) {
      res.status(200).json({ status: 'ignored_duplicate_event' });
      return;
    }

    const sub = repository.getSubscription(subscription_id);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found for webhook' });
      return;
    }

    // Process event according to lifecycle rules
    try {
      let nextStatus: SubscriptionStatus | undefined;
      let invoiceStatus: 'paid' | 'failed' | undefined;

      if (type === 'payment.succeeded') {
        nextStatus = 'active';
        invoiceStatus = 'paid';
      } else if (type === 'payment.failed') {
        nextStatus = 'past_due';
        invoiceStatus = 'failed';
      } else {
        res.status(400).json({ error: `Unsupported webhook type: ${type}` });
        return;
      }

      if (!SubscriptionStateMachine.canTransition(sub.status, nextStatus)) {
        res.status(400).json({
          error: `Invalid lifecycle transition from '${sub.status}' to '${nextStatus}' is strictly forbidden.`,
        });
        return;
      }

      sub.status = SubscriptionStateMachine.transition(sub.status, nextStatus);
      repository.saveSubscription(sub);
      repository.saveInvoice({
        id: invoice_id || `inv_${randomUUID().substring(0, 8)}`,
        subscriptionId: subscription_id,
        amount: amount || 0,
        currency: currency || 'USD',
        status: invoiceStatus,
        createdAt: new Date(),
      });

      repository.markEventProcessed(event_id);
      res.status(200).json({ status: 'processed' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return app;
}