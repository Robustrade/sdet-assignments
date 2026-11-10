// Plays the role of the payment gateway sending webhooks to our app.
import { createHmac, randomUUID } from 'node:crypto';

const WEBHOOK_SECRET = 'demo-webhook-secret'; // shared secret, same as the app's test config

export const newEventId = () => `evt_${randomUUID().slice(0, 8)}`;

export function buildPaymentEvent({ type, subscriptionId, paymentId, eventId = newEventId() }) {
  return { eventId, type, subscriptionId, paymentId };
}

const sign = (body, secret = WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');

export async function sendWebhook(request, event) {
  const body = JSON.stringify(event);
  return request.post('/webhooks/payment', {
    data: body,
    headers: { 'Content-Type': 'application/json', 'x-signature': sign(body) },
  });
}

export async function sendWebhookWithWrongSignature(request, event) {
  const body = JSON.stringify(event);
  return request.post('/webhooks/payment', {
    data: body,
    headers: { 'Content-Type': 'application/json', 'x-signature': sign(body, 'not-the-real-secret') },
  });
}
