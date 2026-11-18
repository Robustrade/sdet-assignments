
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

import { SubscriptionService } from './services/subscription.service';
import { SubscriptionRepository } from './repositories/subscription.repository';
import { AuditRepository } from './repositories/audit.repository';
import { BillingRepository } from './repositories/billing.repository';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import type { PaymentProvider } from './providers/payment-provider';
import type Database from 'better-sqlite3';
import db from './database/connection';
import { getNextStatus } from './state-machine/subscription-state';

export interface AppDependencies {
  database?: Database.Database;
  provider?: PaymentProvider;
  webhookSecret?: string;
}

interface PaymentWebhookEvent {
  event_id: string;
  type:
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.refunded';
  subscription_id: string;
  invoice_id: string;
  transaction_id?: string;
  amount?: number;
}

export function createApp(dependencies: AppDependencies = {}) {
  const database = dependencies.database ?? db;
  const paymentProvider = dependencies.provider ?? new MockPaymentProvider();
  const webhookSecret =
    dependencies.webhookSecret ??
    process.env.WEBHOOK_SECRET ??
    'test-webhook-secret';

  const app = express();

  app.use(express.json({
    verify: (req, res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    }
  }));

  const subscriptionService = new SubscriptionService(
    new SubscriptionRepository(database),
    paymentProvider,
    new AuditRepository(database),
    new BillingRepository(database)
  );

  // Create subscription
  app.post('/subscriptions', (req, res) => {
  try {
    const subscription = subscriptionService.createSubscription(req.body);
    return res.status(201).json(subscription);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Bad request'
      });
  }
});

// Retrieve subscription
  app.get('/subscriptions/:id', (req, res) => {
  try {
    const subscription = subscriptionService.getSubscription(req.params.id);
    return res.status(200).json(subscription);
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : 'Not found'
      });
  }
});

// Cancel subscription
  app.post('/subscriptions/:id/cancel', (req, res) => {
  try {
    const subscription = subscriptionService.cancelSubscription(req.params.id);
    return res.status(200).json(subscription);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Cancellation failed'
      });
  }
});

// Payment endpoint for exercising the mock provider
  app.post('/subscriptions/:id/pay', async (req, res) => {
  try {
    const subscription = await subscriptionService.processPayment(req.params.id);
    return res.status(200).json(subscription);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Payment failed'
      });
  }
});

// Payment provider webhook
  app.post('/webhooks/payment-provider', (req, res) => {
  try {
    const signature = req.headers['x-provider-signature'];
    const rawBody = (req as any).rawBody as Buffer;

    // 1. Verify webhook signature
    if (typeof signature !== 'string' || !rawBody) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const receivedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Validate webhook payload
    const event = req.body as PaymentWebhookEvent;

    if (
      !event ||
      typeof event.event_id !== 'string' ||
      !event.event_id.trim() ||
      typeof event.subscription_id !== 'string' ||
      !event.subscription_id.trim() ||
      typeof event.invoice_id !== 'string' ||
      !event.invoice_id.trim() ||
      ![
        'payment.succeeded',
        'payment.failed',
        'payment.refunded'
      ].includes(event.type)
    ) {
      return res.status(400).json({
        error: 'Invalid webhook payload'
      });
    }

    // 3. Process event atomically
    const processEvent = database.transaction(() => {
      // Check idempotency before processing
      const existingEvent = database.prepare(`
        SELECT event_id
        FROM webhook_events
        WHERE event_id = ?
      `).get(event.event_id);

      if (existingEvent) {
        return 'duplicate';
      }

      // Find subscription
      const subscription = database.prepare(`
        SELECT *
        FROM subscriptions
        WHERE id = ?
      `).get(event.subscription_id) as {
        id: string;
        status: 'trialing' | 'active' | 'past_due' | 'canceled';
      } | undefined;

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      // Find invoice and verify that it belongs to this subscription
      const invoice = database.prepare(`
        SELECT id, status, subscription_id
        FROM invoices
        WHERE id = ? AND subscription_id = ?
      `).get(
        event.invoice_id,
        event.subscription_id
      ) as {
        id: string;
        status: string;
        subscription_id: string;
      } | undefined;

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Every payment event must reference an existing payment attempt
      const payment = database.prepare(`
        SELECT id, status
        FROM payments
        WHERE invoice_id = ?
      `).get(event.invoice_id) as {
        id: string;
        status: string;
      } | undefined;

      if (!payment) {
        throw new Error('Payment record not found');
      }

      let nextStatus = subscription.status;

      // 4. Apply subscription state transitions
      if (event.type === 'payment.succeeded') {
        if (
          subscription.status === 'trialing' ||
          subscription.status === 'past_due'
        ) {
          nextStatus = getNextStatus(
            subscription.status,
            'PAYMENT_SUCCEEDED'
          );
        }
      }

      if (event.type === 'payment.failed') {
        // Ignore an outdated failure for an already successful invoice
        if (invoice.status !== 'succeeded') {
          if (
            subscription.status === 'trialing' ||
            subscription.status === 'active' ||
            subscription.status === 'past_due'
          ) {
            nextStatus = getNextStatus(
              subscription.status,
              'PAYMENT_FAILED'
            );
          }
        }
      }

      // 5. Update subscription and audit log only when state changes
      if (nextStatus !== subscription.status) {
        const timestamp = new Date().toISOString();

        database.prepare(`
          UPDATE subscriptions
          SET status = ?, updated_at = ?, canceled_at = ?
          WHERE id = ?
        `).run(
          nextStatus,
          timestamp,
          nextStatus === 'canceled' ? timestamp : null,
          subscription.id
        );

        database.prepare(`
          INSERT INTO audit_logs
          (subscription_id, old_status, new_status, reason, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          subscription.id,
          subscription.status,
          nextStatus,
          event.type,
          timestamp
        );
      }

      // 6. Update invoice and payment records
      if (event.type === 'payment.succeeded') {
        database.prepare(`
          UPDATE invoices
          SET status = 'succeeded'
          WHERE id = ?
        `).run(invoice.id);

        database.prepare(`
          UPDATE payments
          SET status = 'succeeded'
          WHERE invoice_id = ?
        `).run(invoice.id);
      }

      if (event.type === 'payment.failed') {
        // Do not overwrite a successful billing attempt
        if (invoice.status !== 'succeeded') {
          database.prepare(`
            UPDATE invoices
            SET status = 'failed'
            WHERE id = ?
          `).run(invoice.id);

          database.prepare(`
            UPDATE payments
            SET status = 'failed'
            WHERE invoice_id = ?
          `).run(invoice.id);
        }
      }

      if (event.type === 'payment.refunded') {
        database.prepare(`
          UPDATE invoices
          SET status = 'refunded'
          WHERE id = ?
        `).run(invoice.id);

        database.prepare(`
          UPDATE payments
          SET status = 'refunded'
          WHERE invoice_id = ?
        `).run(invoice.id);
      }

      // 7. Record processed event
      database.prepare(`
        INSERT INTO webhook_events
        (event_id, event_type, processed_at)
        VALUES (?, ?, ?)
      `).run(
        event.event_id,
        event.type,
        new Date().toISOString()
      );

      return 'processed';
    });

    const result = processEvent();

    return res.status(200).json({
      received: true,
      duplicate: result === 'duplicate'
    });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Webhook processing failed';

    const statusCode =
      message === 'Subscription not found' ||
      message === 'Invoice not found' ||
      message === 'Payment record not found'
        ? 404
        : 400;

    return res.status(statusCode).json({
      error: message
    });
  }
  });

  return app;
}

const provider = new MockPaymentProvider();
const app = createApp({ provider });

export { app, provider };
