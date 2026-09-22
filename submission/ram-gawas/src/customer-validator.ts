export interface CustomerValidator {
  isKnownCustomer(customerId: string): boolean;
  isValidPaymentMethod(customerId: string, paymentMethodId: string): boolean;
}

export class CustomerValidationError extends Error {}

export class InMemoryCustomerValidator implements CustomerValidator {
  constructor(
    private paymentMethods: ReadonlyMap<string, readonly string[]>,
  ) {}

  isKnownCustomer(customerId: string): boolean {
    return this.paymentMethods.has(customerId);
  }

  isValidPaymentMethod(customerId: string, paymentMethodId: string): boolean {
    return this.paymentMethods.get(customerId)?.includes(paymentMethodId) ?? false;
  }
}
