import { RequestValidationError } from '../domain/errors';
import type { CreateSubscriptionInput } from '../services/subscriptionService';
import { isWebhookEventType, type PaymentWebhookEvent } from '../services/webhookService';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestValidationError(`'${field}' is required and must be a non-empty string`, 'VALIDATION_ERROR');
  }
  return value;
}

export function parseCreateSubscription(body: unknown): CreateSubscriptionInput {
  if (!isRecord(body)) {
    throw new RequestValidationError('Request body must be a JSON object', 'VALIDATION_ERROR');
  }
  return {
    customerId: requireString(body, 'customer_id'),
    plan: requireString(body, 'plan'),
    paymentMethodId: requireString(body, 'payment_method_id'),
  };
}

export function parseWebhookEvent(rawBody: string): PaymentWebhookEvent {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('Webhook body is not valid JSON', 'MALFORMED_PAYLOAD');
  }
  if (!isRecord(body)) {
    throw new RequestValidationError('Webhook body must be a JSON object', 'MALFORMED_PAYLOAD');
  }

  const eventId = requireString(body, 'event_id');
  const type = requireString(body, 'type');
  if (!isWebhookEventType(type)) {
    throw new RequestValidationError(`Unknown event type '${type}'`, 'UNKNOWN_EVENT_TYPE');
  }
  const subscriptionId = requireString(body, 'subscription_id');
  const invoiceId = requireString(body, 'invoice_id');
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    throw new RequestValidationError("'amount' must be a positive whole number of cents", 'VALIDATION_ERROR');
  }
  const currency = requireString(body, 'currency');
  const failureReason = body.failure_reason;
  if (failureReason !== undefined && typeof failureReason !== 'string') {
    throw new RequestValidationError("'failure_reason' must be a string", 'VALIDATION_ERROR');
  }

  return {
    eventId,
    type,
    subscriptionId,
    invoiceId,
    amountCents: amount,
    currency,
    failureReason: failureReason ?? null,
  };
}
