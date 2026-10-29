import { BillingError } from '../errors';
import { WEBHOOK_EVENT_TYPES, type PaymentWebhookEvent, type WebhookEventType } from '../domain/WebhookEvent';

function malformed(message: string): BillingError {
  return new BillingError('malformed_payload', message);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`"${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Parses and validates the body of a webhook whose signature has already been verified.
 * Shape only (presence, type, supported event type); whether the event makes sense for the current
 * state is the service's decision. Unknown extra fields are allowed.
 */
export function parsePaymentWebhook(rawBody: Buffer): PaymentWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw malformed('Webhook body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw malformed('Webhook body must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;

  const type = requireString(record, 'type');
  if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)) {
    throw malformed(`Unsupported event type "${type}"`);
  }
  const amount = record.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw malformed('"amount" must be a positive integer (minor units)');
  }

  return {
    eventId: requireString(record, 'event_id'),
    type: type as WebhookEventType,
    subscriptionId: requireString(record, 'subscription_id'),
    invoiceId: requireString(record, 'invoice_id'),
    amount,
    currency: requireString(record, 'currency'),
  };
}
