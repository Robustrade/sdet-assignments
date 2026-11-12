import type { LifecycleTrigger, SubscriptionStatus } from './types';

/** Base class for errors the HTTP layer maps to a status code. */
export abstract class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request is malformed or missing fields (HTTP 400). */
export class RequestValidationError extends DomainError {}

/** The request is well formed but breaks a business rule, e.g. an unknown plan (HTTP 422). */
export class BusinessRuleError extends DomainError {}

/** The resource does not exist (HTTP 404). */
export class NotFoundError extends DomainError {}

/** The lifecycle does not allow this trigger from the current status (HTTP 409). */
export class IllegalTransitionError extends DomainError {
  constructor(
    readonly from: SubscriptionStatus,
    readonly trigger: LifecycleTrigger,
  ) {
    super(`'${trigger}' is not allowed when the subscription is '${from}'`, 'INVALID_TRANSITION');
  }
}

/** The row changed between our read and our write (optimistic check failed) (HTTP 409). */
export class StaleStateError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was changed by another operation`, 'STALE_STATE');
  }
}
