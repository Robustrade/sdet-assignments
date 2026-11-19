/**
 * A business/validation error that the HTTP layer maps to a status code and the
 * documented error body `{ error: { code, message, details? } }`.
 */
export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: FieldError[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}
