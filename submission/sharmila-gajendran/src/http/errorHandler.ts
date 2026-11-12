import type { NextFunction, Request, Response } from 'express';
import {
  BusinessRuleError,
  IllegalTransitionError,
  NotFoundError,
  RequestValidationError,
  StaleStateError,
} from '../domain/errors';

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

interface HttpError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

function isJsonParseError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed';
}

function toHttpError(error: unknown): HttpError {
  if (isJsonParseError(error)) {
    return { status: 400, code: 'MALFORMED_PAYLOAD', message: 'Request body is not valid JSON' };
  }
  if (error instanceof RequestValidationError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof BusinessRuleError) {
    return { status: 422, code: error.code, message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: error.code, message: error.message };
  }
  if (error instanceof IllegalTransitionError || error instanceof StaleStateError) {
    return { status: 409, code: error.code, message: error.message };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

/** Express error middleware. It needs all four parameters for Express to treat it as one. */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const { status, code, message } = toHttpError(error);
  res.status(status).json(errorBody(code, message));
}
