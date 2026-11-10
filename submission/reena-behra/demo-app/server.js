// Demo "Subscription & Billing" app used as the system under test.
// It is intentionally small: the assignment is about the TESTS, not the app.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createFreshDatabase, runInTransaction } from './database.js';
import { chargeCard, gatewayCalls } from './fakePaymentGateway.js';
import { PLANS, MAX_FAILED_PAYMENTS } from './plans.js';
import { signBody } from './signature.js';
import { canChangeStatus } from './statusRules.js';

const PORT = Number(process.env.PORT ?? 4000);
const db = createFreshDatabase();
const app = express();

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
const sendError = (res, httpStatus, message) => res.status(httpStatus).json({ error: message });

// ---------- small database helpers ----------

const findCustomer = (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
const findSubscription = (id) => db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
const findPayments = (subscriptionId) =>
  db.prepare('SELECT * FROM payments WHERE subscription_id = ? ORDER BY attempt_no').all(subscriptionId);

// The ONLY place a subscription's status is changed. It refuses changes the rules don't allow.
function changeStatus(subscription, newStatus, reason) {
  if (!canChangeStatus(subscription.status, newStatus)) {
    throw new Error(`Status change ${subscription.status} -> ${newStatus} is not allowed`);
  }
  db.prepare('UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now(), subscription.id);
  db.prepare(
    'INSERT INTO status_history (subscription_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(subscription.id, subscription.status, newStatus, reason, now());
}

// After a failed payment: past_due, or canceled once the customer has failed too many times.
function handleFailedPayment(subscription) {
  const failedCount = findPayments(subscription.id).filter((p) => p.status === 'failed').length;
  if (failedCount >= MAX_FAILED_PAYMENTS) {
    changeStatus(subscription, 'canceled', 'too many failed payments');
  } else if (subscription.status !== 'past_due') {
    changeStatus(subscription, 'past_due', 'payment failed');
  }
}

// ---------- charging a subscription ----------

async function chargeSubscription(subscription) {
  const customer = findCustomer(subscription.customer_id);
  const payments = findPayments(subscription.id);

  // If the last payment's result is still unknown, charging again could charge the customer twice.
  if (payments.some((p) => p.status === 'pending')) {
    return { httpStatus: 409, body: { error: 'A payment is already pending for this subscription' } };
  }

  // Step 1: save the payment as "pending" BEFORE calling the gateway,
  // so we never lose track of money even if something breaks halfway.
  const payment = {
    id: newId('pay'),
    amount: PLANS[subscription.plan].price,
    attemptNo: payments.length + 1,
  };
  db.prepare(
    "INSERT INTO payments (id, subscription_id, amount, status, attempt_no, created_at) VALUES (?, ?, ?, 'pending', ?, ?)",
  ).run(payment.id, subscription.id, payment.amount, payment.attemptNo, now());

  // Step 2: call the payment gateway.
  let result;
  try {
    result = await chargeCard({
      subscriptionId: subscription.id,
      customerId: customer.id,
      card: customer.card,
      amount: payment.amount,
      idempotencyKey: `${subscription.id}-attempt-${payment.attemptNo}`,
    });
  } catch {
    result = 'unknown'; // timeout: we don't know if money was taken, so leave the payment pending
  }

  // Step 3: save the result. Payment row and status change are saved together.
  runInTransaction(db, () => {
    const latest = findSubscription(subscription.id); // re-read: a webhook may have arrived meanwhile
    const current = db.prepare('SELECT status FROM payments WHERE id = ?').get(payment.id);
    if (current.status !== 'pending' || result === 'unknown') return; // already settled by a webhook, or still unknown

    if (result === 'success') {
      db.prepare("UPDATE payments SET status = 'success' WHERE id = ?").run(payment.id);
      if (latest.status !== 'active') changeStatus(latest, 'active', 'payment succeeded');
    } else {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
      handleFailedPayment(latest);
    }
  });

  return { httpStatus: 200, body: { subscription: findSubscription(subscription.id), payments: findPayments(subscription.id) } };
}

// ---------- webhook handling ----------

function handleWebhook(rawBody, signature) {
  // 1. Is it really from the payment gateway?
  if (!signature || signature !== signBody(rawBody)) {
    return { httpStatus: 401, body: { error: 'Invalid signature' } };
  }

  // 2. Is the body usable?
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { httpStatus: 400, body: { error: 'Body is not valid JSON' } };
  }
  if (!event.eventId || !event.type || !event.subscriptionId || !event.paymentId) {
    return { httpStatus: 400, body: { error: 'eventId, type, subscriptionId and paymentId are required' } };
  }

  // 3. Everything below is saved together, or not at all.
  return runInTransaction(db, () => {
    const alreadySeen = db.prepare('SELECT * FROM webhook_events WHERE event_id = ?').get(event.eventId);
    if (alreadySeen) {
      // Duplicate delivery: just count it, do nothing else.
      db.prepare('UPDATE webhook_events SET received_count = received_count + 1 WHERE event_id = ?').run(event.eventId);
      return { httpStatus: 200, body: { result: 'duplicate' } };
    }

    const reasonToIgnore = applyWebhook(event);
    db.prepare(
      'INSERT INTO webhook_events (event_id, type, subscription_id, result, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(event.eventId, event.type, event.subscriptionId, reasonToIgnore ? 'ignored' : 'processed', reasonToIgnore, now());

    return { httpStatus: 200, body: reasonToIgnore ? { result: 'ignored', reason: reasonToIgnore } : { result: 'processed' } };
  });
}

// Applies the event and returns null, or returns the reason it was ignored.
function applyWebhook(event) {
  const subscription = findSubscription(event.subscriptionId);
  if (!subscription) return 'unknown subscription';
  if (subscription.status === 'canceled') return 'subscription is canceled';

  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND subscription_id = ?').get(event.paymentId, subscription.id);
  if (!payment) return 'unknown payment';
  if (payment.status !== 'pending') return `payment is already ${payment.status}`; // late or out-of-order event

  if (event.type === 'payment.succeeded') {
    db.prepare("UPDATE payments SET status = 'success' WHERE id = ?").run(payment.id);
    if (subscription.status !== 'active') changeStatus(subscription, 'active', 'payment confirmed by webhook');
    return null;
  }
  if (event.type === 'payment.failed') {
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
    handleFailedPayment(subscription);
    return null;
  }
  return 'unsupported event type';
}

// ---------- routes ----------

// Webhooks need the raw body to check the signature, so this route is registered before express.json().
app.post('/webhooks/payment', express.raw({ type: () => true }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const { httpStatus, body } = handleWebhook(rawBody, req.get('x-signature'));
  res.status(httpStatus).json(body);
});

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/customers', (req, res) => {
  const { name, card } = req.body ?? {};
  if (!name || !card) return sendError(res, 400, 'name and card are required');
  const customer = { id: newId('cus'), name, card, created_at: now() };
  db.prepare('INSERT INTO customers (id, name, card, created_at) VALUES (?, ?, ?, ?)').run(
    customer.id, customer.name, customer.card, customer.created_at,
  );
  res.status(201).json(customer);
});

// Customer updates their card (used before retrying a declined payment).
app.put('/customers/:id/card', (req, res) => {
  if (!findCustomer(req.params.id)) return sendError(res, 404, 'Customer not found');
  db.prepare('UPDATE customers SET card = ? WHERE id = ?').run(req.body?.card, req.params.id);
  res.json(findCustomer(req.params.id));
});

app.post('/subscriptions', async (req, res) => {
  const { customerId, plan } = req.body ?? {};
  const idempotencyKey = req.get('idempotency-key') ?? null;

  // Same Idempotency-Key as an earlier request -> return the earlier result, don't create or charge again.
  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM subscriptions WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return res.status(200).json(existing);
  }

  if (!customerId || !plan) return sendError(res, 400, 'customerId and plan are required');
  if (!PLANS[plan]) return sendError(res, 400, `Unknown plan: ${plan}`);
  if (!findCustomer(customerId)) return sendError(res, 404, 'Customer not found');

  const subscription = { id: newId('sub'), status: 'trialing' };
  runInTransaction(db, () => {
    db.prepare(
      'INSERT INTO subscriptions (id, customer_id, plan, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(subscription.id, customerId, plan, 'trialing', idempotencyKey, now(), now());
    db.prepare(
      "INSERT INTO status_history (subscription_id, from_status, to_status, reason, created_at) VALUES (?, NULL, 'trialing', 'created', ?)",
    ).run(subscription.id, now());
  });

  if (PLANS[plan].chargeAtSignup) await chargeSubscription(findSubscription(subscription.id));
  res.status(201).json(findSubscription(subscription.id));
});

app.get('/subscriptions/:id', (req, res) => {
  const subscription = findSubscription(req.params.id);
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  res.json(subscription);
});

app.get('/subscriptions/:id/payments', (req, res) => {
  if (!findSubscription(req.params.id)) return sendError(res, 404, 'Subscription not found');
  res.json(findPayments(req.params.id));
});

// Charge now: used at the end of a trial, or to retry a failed payment. (In real life a billing job calls this.)
app.post('/subscriptions/:id/charge', async (req, res) => {
  const subscription = findSubscription(req.params.id);
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  if (subscription.status === 'active') return sendError(res, 409, 'Subscription is already paid');
  if (subscription.status === 'canceled') return sendError(res, 409, 'Subscription is canceled');
  const { httpStatus, body } = await chargeSubscription(subscription);
  res.status(httpStatus).json(body);
});

app.post('/subscriptions/:id/cancel', (req, res) => {
  const subscription = findSubscription(req.params.id);
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  if (!canChangeStatus(subscription.status, 'canceled')) return sendError(res, 409, 'Subscription is already canceled');
  changeStatus(subscription, 'canceled', 'canceled by customer');
  res.json(findSubscription(subscription.id));
});

// TEST-ONLY endpoint: lets tests check what was sent to the fake payment gateway.
app.get('/test-support/gateway-calls', (req, res) => {
  const { subscriptionId, customerId } = req.query;
  res.json(gatewayCalls.filter((call) => call.subscriptionId === subscriptionId || call.customerId === customerId));
});

app.listen(PORT, () => console.log(`Demo billing app running on http://localhost:${PORT}`));
