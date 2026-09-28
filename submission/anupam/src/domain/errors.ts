import type { SubscriptionStatus } from './types';

/** Base class: every domain error knows its HTTP mapping and machine-readable code. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, 400, details);
  }
}
export class UnknownPlanError extends DomainError {
  constructor(plan: string) {
    super('unknown_plan', `Plan '${plan}' does not exist`, 422);
  }
}
export class UnknownCustomerError extends DomainError {
  constructor(id: string) {
    super('unknown_customer', `Customer '${id}' does not exist`, 422);
  }
}
export class InvalidPaymentMethodError extends DomainError {
  constructor(id: string) {
    super('invalid_payment_method', `Payment method '${id}' does not belong to customer`, 422);
  }
}
export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} '${id}' not found`, 404);
  }
}
export class InvalidTransitionError extends DomainError {
  constructor(readonly from: SubscriptionStatus, readonly event: string) {
    super('invalid_transition', `Cannot apply '${event}' to a subscription in '${from}'`, 409);
  }
}
export class InvalidSignatureError extends DomainError {
  constructor() {
    super('invalid_signature', 'Webhook signature is missing or invalid', 401);
  }
}
export class MalformedWebhookError extends DomainError {
  constructor(message: string) {
    super('malformed_payload', message, 400);
  }
}
export class ConcurrentModificationError extends DomainError {
  constructor(id: string) {
    super('concurrent_modification', `Subscription '${id}' was modified concurrently`, 409);
  }
}
