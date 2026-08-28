const crypto = require('crypto');
const express = require('express');
const { repository, subscriptionService } = require('../billingContext');

const router = express.Router();
const webhookSecret = process.env.WEBHOOK_SECRET || 'assignment-secret';

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(subscriptionService.createSubscription(req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  const subscription = subscriptionService.getSubscription(req.params.id);
  if (!subscription) return res.status(404).json({ message: 'Subscription not found' });
  res.status(200).json(subscription);
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    res.status(200).json(subscriptionService.cancelSubscription(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/plan', (req, res, next) => {
  try {
    res.status(200).json(subscriptionService.changePlan(req.params.id, req.body.plan));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/charge', (req, res, next) => {
  try {
    res.status(200).json(subscriptionService.charge(req.params.id).subscription);
  } catch (error) {
    next(error);
  }
});

router.post('/webhooks/payment-provider', (req, res, next) => {
  const signature = req.get('X-Provider-Signature');
  const expected = crypto.createHmac('sha256', webhookSecret).update(req.rawBody || '').digest('hex');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ message: 'Invalid provider signature' });
  }

  if (!req.body || !req.body.event_id || !req.body.type || !req.body.subscription_id || !req.body.invoice_id) {
    return res.status(400).json({ message: 'Malformed webhook payload' });
  }

  try {
    const result = subscriptionService.processWebhook(req.body);
    res.status(200).json({ duplicate: result.duplicate, subscription: result.subscription });
  } catch (error) {
    next(error);
  }
});

module.exports = router;