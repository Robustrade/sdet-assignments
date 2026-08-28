const express = require('express');
const router = express.Router();
const { repository, paymentProvider } = require('../billingContext');

router.post('/reset', (req, res) => {
  repository.reset();
  paymentProvider.reset();
  repository.addCustomer({ id: 'cust_001', name: 'Test Customer' });
  res.status(200).json({ message: 'Reset successful' });
});

router.post('/provider', (req, res) => {
  paymentProvider.configure(req.body.outcome);
  res.status(200).json({ outcome: paymentProvider.outcome });
});

router.get('/state/:id', (req, res) => {
  const snapshot = repository.snapshot(req.params.id);
  if (!snapshot.subscription) return res.status(404).json({ message: 'Subscription not found' });
  res.status(200).json({ ...snapshot, provider_calls: paymentProvider.calls });
});

module.exports = router;
