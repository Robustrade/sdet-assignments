import { randomUUID } from 'crypto';
import express from 'express';

const app = express();

app.use(express.json());

interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  status: string;
}

const subscriptions = new Map<string, Subscription>();

// Store webhook event IDs that have already been processed
const processedWebhookEvents = new Set<string>();

// Create subscription
app.post('/subscriptions', (req, res) => {
  const { customerId, plan } = req.body;

  if (!customerId || !plan) {
    return res.status(400).json({
      error: 'customerId and plan are required',
    });
  }

  if (plan !== 'basic' && plan !== 'pro') {
    return res.status(400).json({
      error: 'Invalid plan',
    });
  }

  const subscription: Subscription = {
    id: randomUUID(),
    customerId,
    plan,
    status: 'trialing',
  };

  subscriptions.set(subscription.id, subscription);

  return res.status(201).json(subscription);
});

// Get subscription
app.get('/subscriptions/:id', (req, res) => {
  const subscription = subscriptions.get(req.params.id);

  if (!subscription) {
    return res.status(404).json({
      error: 'Subscription not found',
    });
  }

  return res.status(200).json(subscription);
});

// Cancel subscription
app.post('/subscriptions/:id/cancel', (req, res) => {
  const subscription = subscriptions.get(req.params.id);

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
  subscriptions.set(subscription.id, subscription);

  return res.status(200).json(subscription);
});

// Payment webhook
app.post('/webhooks/payment-provider', (req, res) => {
  const { event_id, event_type, subscription_id } = req.body;

  if (!event_id || !event_type || !subscription_id) {
    return res.status(400).json({
      error: 'Invalid webhook payload',
    });
  }

  // Check whether this event was already processed
  if (processedWebhookEvents.has(event_id)) {
    return res.status(200).json({
      message: 'Webhook already processed',
      event_id,
    });
  }

  const subscription = subscriptions.get(subscription_id);

  if (!subscription) {
    return res.status(404).json({
      error: 'Subscription not found',
    });
  }

  if (event_type === 'payment.succeeded') {
    if (
      subscription.status === 'trialing' ||
      subscription.status === 'past_due'
    ) {
      subscription.status = 'active';
    }
  } else if (event_type === 'payment.failed') {
    if (
      subscription.status === 'trialing' ||
      subscription.status === 'active'
    ) {
      subscription.status = 'past_due';
    }
  } else if (event_type === 'payment.refunded') {
    // Refund behavior will be added later.
  } else {
    return res.status(400).json({
      error: 'Unsupported event type',
    });
  }

  subscriptions.set(subscription.id, subscription);

  // Mark the event as processed only after successful processing
  processedWebhookEvents.add(event_id);

  return res.status(200).json({
    message: 'Webhook processed',
    event_id,
    status: subscription.status,
  });
});

export default app;