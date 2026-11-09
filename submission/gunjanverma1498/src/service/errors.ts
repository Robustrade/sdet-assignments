/**
 * Domain errors. Each carries the HTTP status and a stable machine-readable
 * `code` so the HTTP layer can translate them uniformly and tests can assert on
 * the code rather than brittle message text.
 */
export abstract class ServiceError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
}

export class ValidationError extends ServiceError {
  readonly status = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ServiceError {
  readonly status = 404;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ServiceError {
  readonly status = 409;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class SignatureError extends ServiceError {
  readonly status = 401;
  readonly code = 'invalid_signature';
  constructor(message = 'webhook signature verification failed') {
    super(message);
    this.name = 'SignatureError';
  }
}
