// Small helper functions used by all API tests.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// ---------- API ----------

export async function createCustomer(request, card = 'card_ok') {
  const response = await request.post('/customers', { data: { card } });
  return response.json();
}

export function subscribe(request, customerId, plan, idempotencyKey = randomUUID()) {
  return request.post('/subscriptions', {
    data: { customerId, plan },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// Creates a customer with this card and subscribes them to the plan.
export async function createSubscription(request, plan, card = 'card_ok') {
  const customer = await createCustomer(request, card);
  const response = await subscribe(request, customer.id, plan);
  expect(response.status()).toBe(201);
  return { customer, subscription: await response.json() };
}

export async function getPayments(request, subscriptionId) {
  const response = await request.get(`/subscriptions/${subscriptionId}/payments`);
  return response.json();
}

// The tests play the payment gateway and send its webhooks.
export function sendWebhook(request, type, subscriptionId, paymentId, eventId = `evt_${randomUUID()}`) {
  return request.post('/webhooks/payment', { data: { eventId, type, subscriptionId, paymentId } });
}

// ---------- Database (read-only: tests only look, never change) ----------

function readDb(sql, ...params) {
  const db = new DatabaseSync('demo-app/demo.db', { readOnly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

export const subscriptionInDb = (id) => readDb('SELECT * FROM subscriptions WHERE id = ?', id)[0];
export const subscriptionsOfCustomerInDb = (customerId) => readDb('SELECT * FROM subscriptions WHERE customer_id = ?', customerId);
export const paymentsInDb = (subscriptionId) => readDb('SELECT * FROM payments WHERE subscription_id = ?', subscriptionId);

// ---------- The main check: API and database must agree ----------

export async function expectApiMatchesDb(request, subscriptionId) {
  const fromApi = await (await request.get(`/subscriptions/${subscriptionId}`)).json();
  const fromDb = subscriptionInDb(subscriptionId);
  expect(fromApi).toEqual(fromDb);
  expect(await getPayments(request, subscriptionId)).toEqual(paymentsInDb(subscriptionId));
  return fromDb;
}
