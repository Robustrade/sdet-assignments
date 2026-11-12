import { ApiError } from '../errors.js';

export const WEBHOOK_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

export interface WebhookPayload {
  event_id: string;
  type: WebhookType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

function malformed(message: string): ApiError {
  return new ApiError(400, 'malformed_payload', message);
}

/** Structural validation only. Business rules live in the service. */
export function parseWebhookPayload(body: unknown): WebhookPayload {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed('payload must be a JSON object');
  }
  const p = body as Record<string, unknown>;
  for (const field of ['event_id', 'subscription_id', 'invoice_id', 'currency'] as const) {
    if (typeof p[field] !== 'string' || p[field] === '') {
      throw malformed(`${field} is required`);
    }
  }
  if (!WEBHOOK_TYPES.includes(p.type as WebhookType)) {
    throw malformed('type is missing or unsupported');
  }
  if (!Number.isInteger(p.amount) || (p.amount as number) <= 0) {
    throw malformed('amount must be a positive integer (minor units)');
  }
  return p as unknown as WebhookPayload;
}
