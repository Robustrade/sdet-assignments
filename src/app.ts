
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import express from 'express';
import { getPlanConfig } from './services/planConfig';
import { SubscriptionRepository } from './repositories/subscriptionRepository';

const app = express();

app.use(express.json());

const webhookSecret = process.env.WEBHOOK_SECRET || 'test_webhook_secret';
const MAX_PAYMENT_ATTEMPTS = 3;

const subscriptionRepository = new SubscriptionRepository();
const processedWebhookEvents = new Set<string>();

// Create subscription
app.post('/subscriptions', (req, res) => {
  const { customerId, plan } = req.body;

  if (!customerId || !plan) {
    return res.status(400).json({
      error: 'customerId and plan are required',
    });
  }

  const planConfig = getPlanConfig(plan);

  if (!planConfig) {
    return res.status(400).json({
      error: 'Invalid plan',
    });
  }

  const subscription = {
    id: randomUUID(),
    customerId,
    plan,
    status: 'trialing',
    priceCents: planConfig.priceCents,
    trialDays: planConfig.trialDays,
    retryCount: 0,
  };

  subscriptionRepository.save(subscription);

  return res.status(201).json(subscription);
});

// Get subscription
app.get('/subscriptions/:id', (req, res) => {
  const subscription = subscriptionRepository.findById(req.params.id);

  if (!subscription) {
    return res.status(404).json({
      error: 'Subscription not found',
    });
  }

  return res.status(200).json(subscription);
});

// Cancel subscription
app.post('/subscriptions/:id/cancel', (req, res) => {
  const subscription = subscriptionRepository.findById(req.params.id);

  if (!subscription) {
    return res.status(404).json({
      error: 'Subscription not found',
    });
  }

  if (subscription.status === 'canceled') {
    return res.status(400).json({
      error: 'Subscription is already canceled',
    });
  }

  subscription.status = 'canceled';
  subscriptionRepository.save(subscription);

  return res.status(200).json(subscription);
});

// Payment webhook
app.post('/webhooks/payment-provider', (req, res) => {
  const signature = req.headers['x-webhook-signature'];

  if (!signature || typeof signature !== 'string') {
    return res.status(401).json({
      error: 'Missing webhook signature',
    });
  }

  const expectedSignature = createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(401).json({
      error: 'Invalid webhook signature',
    });
  }

  const receivedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({
      error: 'Invalid webhook signature',
    });
  }

  const { event_id, event_type, subscription_id } = req.body;

  if (!event_id || !event_type || !subscription_id) {
    return res.status(400).json({
      error: 'Invalid webhook payload',
    });
  }

  if (processedWebhookEvents.has(event_id)) {
    return res.status(200).json({
      message: 'Webhook already processed',
      event_id,
    });
  }

  const subscription = subscriptionRepository.findById(subscription_id);

  if (!subscription) {
    return res.status(404).json({
      error: 'Subscription not found',
    });
  }

  // Canceled subscriptions cannot change state again.
  if (subscription.status === 'canceled') {
    processedWebhookEvents.add(event_id);

    return res.status(200).json({
      message: 'Subscription is already canceled',
      event_id,
      status: subscription.status,
    });
  }

  if (event_type === 'payment.succeeded') {
    if (
      subscription.status === 'trialing' ||
      subscription.status === 'past_due'
    ) {
      subscription.status = 'active';
      subscription.retryCount = 0;
    }
  } else if (event_type === 'payment.failed') {
    if (
      subscription.status === 'trialing' ||
      subscription.status === 'active' ||
      subscription.status === 'past_due'
    ) {
      subscription.retryCount += 1;

      if (subscription.retryCount >= MAX_PAYMENT_ATTEMPTS) {
        subscription.status = 'canceled';
      } else {
        subscription.status = 'past_due';
      }
    }
  } else if (event_type === 'payment.refunded') {
    // Refund behavior will be implemented later.
  } else {
    return res.status(400).json({
      error: 'Unsupported event type',
    });
  }

  subscriptionRepository.save(subscription);
  processedWebhookEvents.add(event_id);

  return res.status(200).json({
    message: 'Webhook processed',
    event_id,
    status: subscription.status,
    retryCount: subscription.retryCount,
  });
});

export default app;
