import { AppError, FieldError } from '../domain/errors';
import { WEBHOOK_EVENT_TYPES, WebhookEventType } from '../domain/types';

export interface WebhookPayload {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  /** Optional extra field (assumption A-13); not part of the assignment's example. */
  providerReference?: string;
}

/** Parses and validates the raw body. Throws 400 INVALID_EVENT on any problem. */
export function parseWebhookPayload(rawBody: Buffer): WebhookPayload {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_EVENT', 'Webhook body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_EVENT', 'Webhook body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  const requireString = (field: string) => {
    if (typeof b[field] !== 'string' || (b[field] as string).length === 0) {
      errors.push({ field, message: `${field} must be a non-empty string` });
    }
  };
  ['event_id', 'subscription_id', 'invoice_id', 'currency'].forEach(requireString);
  if (!WEBHOOK_EVENT_TYPES.includes(b.type as WebhookEventType)) {
    errors.push({ field: 'type', message: `type must be one of ${WEBHOOK_EVENT_TYPES.join(', ')}` });
  }
  if (!Number.isInteger(b.amount) || (b.amount as number) < 0) {
    errors.push({ field: 'amount', message: 'amount must be a non-negative integer (minor units)' });
  }
  if (b.provider_reference !== undefined) requireString('provider_reference');
  if (errors.length > 0) throw new AppError(400, 'INVALID_EVENT', 'Webhook payload validation failed', errors);

  return {
    eventId: b.event_id as string,
    type: b.type as WebhookEventType,
    subscriptionId: b.subscription_id as string,
    invoiceId: b.invoice_id as string,
    amount: b.amount as number,
    currency: b.currency as string,
    providerReference: b.provider_reference as string | undefined,
  };
}
