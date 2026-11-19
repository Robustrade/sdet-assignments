import { AppError, FieldError } from '../domain/errors';
import { CreateSubscriptionInput } from '../services/subscription-service';

/** Validates the create-subscription body; missing or wrongly typed fields -> 400 VALIDATION_ERROR. */
export function parseCreateSubscriptionRequest(body: unknown): CreateSubscriptionInput {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const field of ['customer_id', 'plan', 'payment_method_id']) {
    const value = b[field];
    if (value === undefined || value === null || value === '') errors.push({ field, message: `${field} is required` });
    else if (typeof value !== 'string') errors.push({ field, message: `${field} must be a string` });
  }
  if (errors.length > 0) throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', errors);
  return {
    customerId: b.customer_id as string,
    planId: b.plan as string,
    paymentMethodId: b.payment_method_id as string,
  };
}

/** Optional `Idempotency-Key` header: absent is fine, but if present it must be 1-255 characters. */
export function parseIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  if (header.length === 0 || header.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be 1-255 characters' },
    ]);
  }
  return header;
}
