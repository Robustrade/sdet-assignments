// Demo "Subscription & Billing" app: the system under test.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const PRICES = { basic: 1900, pro: 4900 }; // in cents. basic = free trial, pro = pay now

// ---------- Database: starts empty every time the app starts ----------
const DB_FILE = 'demo-app/demo.db';
for (const file of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) rmSync(file, { force: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL'); // lets the tests read the database while the app is writing
db.exec(`
  CREATE TABLE customers      (id TEXT PRIMARY KEY, card TEXT);
  CREATE TABLE subscriptions  (id TEXT PRIMARY KEY, customer_id TEXT, plan TEXT, status TEXT, idempotency_key TEXT UNIQUE);
  CREATE TABLE payments       (id TEXT PRIMARY KEY, subscription_id TEXT, amount INTEGER, status TEXT);
  CREATE TABLE webhook_events (event_id TEXT PRIMARY KEY, result TEXT);
`);

const findOne = (sql, ...params) => db.prepare(sql).get(...params);
const findAll = (sql, ...params) => db.prepare(sql).all(...params);
const save = (sql, ...params) => db.prepare(sql).run(...params);
const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
const getSubscription = (id) => findOne('SELECT * FROM subscriptions WHERE id = ?', id);

// Saves the payment result and the subscription status together: both or neither.
function savePaymentResult(subscriptionId, paymentId, paymentStatus, subscriptionStatus) {
  db.exec('BEGIN');
  try {
    save('UPDATE payments SET status = ? WHERE id = ?', paymentStatus, paymentId);
    save('UPDATE subscriptions SET status = ? WHERE id = ?', subscriptionStatus, subscriptionId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK'); // something failed: undo both
    throw error;
  }
}

// ---------- Fake payment gateway: the card decides the result ----------
function fakePaymentGateway(card) {
  if (card === 'card_ok') return 'success';
  if (card === 'card_declined') return 'failed';
  return 'timeout'; // card_timeout: the gateway did not answer
}

function chargeSubscription(subscription) {
  const customer = findOne('SELECT * FROM customers WHERE id = ?', subscription.customer_id);

  // 1. Save the payment as "pending" BEFORE calling the gateway, so it is never lost.
  const paymentId = newId('pay');
  save("INSERT INTO payments VALUES (?, ?, ?, 'pending')", paymentId, subscription.id, PRICES[subscription.plan]);

  // 2. Ask the gateway, then save the result.
  //    On a timeout we don't know the result yet, so we change nothing (the webhook will tell us).
  const result = fakePaymentGateway(customer.card);
  if (result === 'success') savePaymentResult(subscription.id, paymentId, 'success', 'active');
  if (result === 'failed') savePaymentResult(subscription.id, paymentId, 'failed', 'past_due');
}

// ---------- API ----------
const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/customers', (req, res) => {
  const customer = { id: newId('cus'), card: req.body.card };
  save('INSERT INTO customers VALUES (?, ?)', customer.id, customer.card);
  res.status(201).json(customer);
});

app.put('/customers/:id/card', (req, res) => {
  save('UPDATE customers SET card = ? WHERE id = ?', req.body.card, req.params.id);
  res.json({ id: req.params.id, card: req.body.card });
});

app.post('/subscriptions', (req, res) => {
  const { customerId, plan } = req.body;
  const idempotencyKey = req.get('Idempotency-Key');

  // Same Idempotency-Key as before? Return the first result. Don't create or charge again.
  const earlier = findOne('SELECT * FROM subscriptions WHERE idempotency_key = ?', idempotencyKey);
  if (earlier) return res.status(200).json(earlier);

  if (!PRICES[plan]) return res.status(400).json({ error: `Unknown plan: ${plan}` });

  const id = newId('sub');
  const status = plan === 'basic' ? 'trialing' : 'pending'; // pro waits for its first payment
  save('INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?)', id, customerId, plan, status, idempotencyKey);
  if (plan === 'pro') chargeSubscription(getSubscription(id));
  res.status(201).json(getSubscription(id));
});

app.get('/subscriptions/:id', (req, res) => {
  const subscription = getSubscription(req.params.id);
  if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
  res.json(subscription);
});

app.get('/subscriptions/:id/payments', (req, res) => {
  res.json(findAll('SELECT * FROM payments WHERE subscription_id = ?', req.params.id));
});

// Retry a failed payment. Only allowed when the subscription is past_due.
app.post('/subscriptions/:id/charge', (req, res) => {
  const subscription = getSubscription(req.params.id);
  if (subscription.status !== 'past_due') {
    return res.status(409).json({ error: `Cannot charge a subscription that is ${subscription.status}` });
  }
  chargeSubscription(subscription);
  res.json(getSubscription(subscription.id));
});

app.post('/subscriptions/:id/cancel', (req, res) => {
  const subscription = getSubscription(req.params.id);
  if (subscription.status === 'canceled') return res.status(409).json({ error: 'Already canceled' });
  save("UPDATE subscriptions SET status = 'canceled' WHERE id = ?", subscription.id);
  res.json(getSubscription(subscription.id));
});

// ---------- Webhook: the payment gateway tells us the final result of a payment ----------
app.post('/webhooks/payment', (req, res) => {
  const { eventId, type, subscriptionId, paymentId } = req.body;

  // 1. Seen this event before? Do nothing again.
  if (findOne('SELECT * FROM webhook_events WHERE event_id = ?', eventId)) {
    return res.json({ result: 'duplicate' });
  }

  // 2. Ignore events that come too late or in the wrong order.
  const subscription = getSubscription(subscriptionId);
  const payment = findOne('SELECT * FROM payments WHERE id = ?', paymentId);
  let result = 'processed';
  if (subscription.status === 'canceled') result = 'ignored: subscription is canceled';
  else if (payment.status !== 'pending') result = `ignored: payment is already ${payment.status}`;

  // 3. Apply it, then remember the event. (If applying fails, the event is not remembered,
  //    so the gateway's retry of the same event will still be processed.)
  if (result === 'processed' && type === 'payment.succeeded') savePaymentResult(subscriptionId, paymentId, 'success', 'active');
  if (result === 'processed' && type === 'payment.failed') savePaymentResult(subscriptionId, paymentId, 'failed', 'past_due');
  save('INSERT INTO webhook_events VALUES (?, ?)', eventId, result);
  res.json({ result });
});

app.listen(4000, () => console.log('Demo billing app running on http://localhost:4000'));
