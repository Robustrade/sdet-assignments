// Small functions that call the demo app's API, so tests read like steps.
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { CARDS, uniqueName } from './testData.js';

export async function createCustomer(request, card = CARDS.ok) {
  const response = await request.post('/customers', { data: { name: uniqueName(), card } });
  expect(response.status()).toBe(201);
  return response.json();
}

export async function createSubscription(request, { customerId, plan, idempotencyKey = randomUUID() }) {
  return request.post('/subscriptions', {
    data: { customerId, plan },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// Creates a customer with the given card and subscribes them. Returns both.
export async function createCustomerWithSubscription(request, { plan, card = CARDS.ok }) {
  const customer = await createCustomer(request, card);
  const response = await createSubscription(request, { customerId: customer.id, plan });
  expect(response.status()).toBe(201);
  return { customer, subscription: await response.json() };
}

export async function getSubscription(request, subscriptionId) {
  const response = await request.get(`/subscriptions/${subscriptionId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

export async function getPayments(request, subscriptionId) {
  const response = await request.get(`/subscriptions/${subscriptionId}/payments`);
  expect(response.status()).toBe(200);
  return response.json();
}

export const chargeSubscription = (request, subscriptionId) => request.post(`/subscriptions/${subscriptionId}/charge`);

export const cancelSubscription = (request, subscriptionId) => request.post(`/subscriptions/${subscriptionId}/cancel`);

export async function updateCard(request, customerId, card) {
  const response = await request.put(`/customers/${customerId}/card`, { data: { card } });
  expect(response.status()).toBe(200);
}

// What did the app send to the fake payment gateway for this subscription?
export async function getGatewayCalls(request, subscriptionId) {
  const response = await request.get('/test-support/gateway-calls', { params: { subscriptionId } });
  return response.json();
}

export async function getGatewayCallsForCustomer(request, customerId) {
  const response = await request.get('/test-support/gateway-calls', { params: { customerId } });
  return response.json();
}
