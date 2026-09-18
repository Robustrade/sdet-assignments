export type ErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_PLAN'
  | 'UNKNOWN_CUSTOMER'
  | 'UNKNOWN_PAYMENT_METHOD'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'INVOICE_NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'INVALID_SIGNATURE'
  | 'MALFORMED_PAYLOAD'
  | 'INVALID_PAYLOAD';

/** Single error type carrying the HTTP mapping, so route handlers stay thin. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'DomainError';
  }

  static missingField(field: string): DomainError {
    return new DomainError('MISSING_FIELD', `Missing required field: ${field}`, 400, { field });
  }

  static invalidPlan(plan: unknown): DomainError {
    return new DomainError('INVALID_PLAN', `Unknown plan: ${String(plan)}`, 400, { plan });
  }

  static unknownCustomer(customerId: string): DomainError {
    return new DomainError('UNKNOWN_CUSTOMER', `Unknown customer: ${customerId}`, 400, {
      customer_id: customerId
    });
  }

  static unknownPaymentMethod(pm: string): DomainError {
    return new DomainError('UNKNOWN_PAYMENT_METHOD', `Unknown payment method: ${pm}`, 400, {
      payment_method_id: pm
    });
  }

  static subscriptionNotFound(id: string): DomainError {
    return new DomainError('SUBSCRIPTION_NOT_FOUND', `Unknown subscription: ${id}`, 404, {
      subscription_id: id
    });
  }

  static invoiceNotFound(id: string): DomainError {
    return new DomainError('INVOICE_NOT_FOUND', `Unknown invoice: ${id}`, 404, { invoice_id: id });
  }

  static illegalTransition(from: string, trigger: string): DomainError {
    return new DomainError(
      'ILLEGAL_TRANSITION',
      `Transition '${trigger}' is not permitted from state '${from}'`,
      409,
      { from, trigger }
    );
  }
}
