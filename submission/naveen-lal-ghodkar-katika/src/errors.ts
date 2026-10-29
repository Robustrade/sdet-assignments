export type BillingErrorCode =
  | 'validation_error'
  | 'malformed_json'
  | 'invalid_plan'
  | 'invalid_payment_method'
  | 'customer_not_found'
  | 'subscription_not_found'
  | 'invalid_transition'
  | 'idempotency_conflict'
  | 'invalid_signature'
  | 'malformed_payload'
  | 'provider_timeout';

/** Expected, client-facing failure. The HTTP layer maps `code` to a status. */
export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}
