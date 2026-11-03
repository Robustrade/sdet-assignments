/** Base class for errors that map onto an HTTP response. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RequestValidationError extends AppError {
  constructor(details: unknown) {
    super('validation_error', 400, 'Request body failed validation', details);
  }
}

export class UnprocessableError extends AppError {
  constructor(code: string, message: string) {
    super(code, 422, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource}_not_found`, 404, `${resource} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, 409, message);
  }
}

/** A guarded UPDATE matched no row: the record changed underneath us. */
export class StaleStateError extends ConflictError {
  constructor(entity: string, id: string) {
    super('concurrent_modification', `${entity} ${id} was modified concurrently`);
  }
}
