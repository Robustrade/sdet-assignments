// All API calls in one place. The tests call these functions.
import { randomUUID } from 'node:crypto';
import { CARDS } from '../test-data/testData.js';

export async function createCustomer(request, card = CARDS.ok) {
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
export async function createSubscription(request, plan, card = CARDS.ok) {
  const customer = await createCustomer(request, card);
  const response = await subscribe(request, customer.id, plan);
  return { customer, subscription: await response.json() };
}

export async function getSubscription(request, subscriptionId) {
  const response = await request.get(`/subscriptions/${subscriptionId}`);
  return response.json();
}

export async function getPayments(request, subscriptionId) {
  const response = await request.get(`/subscriptions/${subscriptionId}/payments`);
  return response.json();
}

export function changeCard(request, customerId, card) {
  return request.put(`/customers/${customerId}/card`, { data: { card } });
}

export function retryPayment(request, subscriptionId) {
  return request.post(`/subscriptions/${subscriptionId}/charge`);
}

export function cancelSubscription(request, subscriptionId) {
  return request.post(`/subscriptions/${subscriptionId}/cancel`);
}

// The test plays the payment gateway and sends its webhook.
export function sendWebhook(request, type, subscriptionId, paymentId, eventId = `evt_${randomUUID()}`) {
  return request.post('/webhooks/payment', { data: { eventId, type, subscriptionId, paymentId } });
}
