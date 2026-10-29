import type { ErrorRequestHandler } from 'express';
import { BillingError, type BillingErrorCode } from '../errors';

const STATUS_BY_CODE: Record<BillingErrorCode, number> = {
  validation_error: 400,
  malformed_json: 400,
  invalid_plan: 422,
  invalid_payment_method: 422,
  customer_not_found: 422,
  subscription_not_found: 404,
  invalid_transition: 409,
  idempotency_conflict: 409,
  invalid_signature: 401,
  malformed_payload: 400,
  provider_timeout: 504,
};

function envelope(code: string, message: string) {
  return { error: { code, message } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BillingError) {
    res.status(STATUS_BY_CODE[err.code]).json(envelope(err.code, err.message));
    return;
  }
  // body-parser signals unparseable JSON with this error type
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json(envelope('malformed_json', 'Request body is not valid JSON'));
    return;
  }
  res.status(500).json(envelope('internal_error', 'Unexpected error'));
};
