/**
 * Domain and transport-boundary error hierarchy.
 * Author: Vedant Dalkari
 */

import type { SubscriptionStatus } from './types.js';

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends DomainError {
  public constructor(message: string) {
    super(message, 'validation_error', 400);
  }
}

export class UnauthorizedError extends DomainError {
  public constructor(message: string) {
    super(message, 'unauthorized', 401);
  }
}

export class NotFoundError extends DomainError {
  public constructor(message: string) {
    super(message, 'not_found', 404);
  }
}

export class ConflictError extends DomainError {
  public constructor(message: string) {
    super(message, 'conflict', 409);
  }
}

export class UnprocessableEntityError extends DomainError {
  public constructor(message: string) {
    super(message, 'unprocessable_entity', 422);
  }
}

export class InvalidTransitionError extends DomainError {
  public readonly fromStatus: SubscriptionStatus | null;
  public readonly trigger: string;

  public constructor(
    fromStatus: SubscriptionStatus | null,
    trigger: string,
    message?: string,
  ) {
    super(
      message ?? `Illegal lifecycle transition from "${String(fromStatus)}" via "${trigger}"`,
      'invalid_transition',
      409,
    );
    this.fromStatus = fromStatus;
    this.trigger = trigger;
  }
}
