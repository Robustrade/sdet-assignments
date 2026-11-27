export type ErrorCode =
  | 'invalid_request'
  | 'unknown_plan'
  | 'unknown_customer'
  | 'invalid_payment_method'
  | 'not_found'
  | 'invalid_transition'
  | 'idempotency_key_reused'
  | 'request_in_progress'
  | 'missing_signature'
  | 'invalid_signature'
  | 'malformed_payload';

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  malformed_payload: 400,
  unknown_plan: 422,
  unknown_customer: 422,
  invalid_payment_method: 422,
  not_found: 404,
  invalid_transition: 409,
  idempotency_key_reused: 409,
  request_in_progress: 409,
  missing_signature: 401,
  invalid_signature: 401,
};

export class DomainError extends Error {
  readonly httpStatus: number;

  constructor(readonly code: ErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.httpStatus = STATUS[code];
  }
}
