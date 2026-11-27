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

// Get subscription by ID
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

export default app;