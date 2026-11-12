import type { Customer, PaymentMethod } from '../../../src/domain/types';

export interface CustomerSeed {
  readonly customer: Customer;
  readonly paymentMethods: readonly PaymentMethod[];
}

/** Builds a customer and their payment methods for seeding the test database. */
export class CustomerBuilder {
  private id = 'cust_test';
  private email: string | undefined;
  private readonly paymentMethodIds: string[] = [];

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodIds.push(paymentMethodId);
    return this;
  }

  build(): CustomerSeed {
    return {
      customer: { id: this.id, email: this.email ?? `${this.id}@example.test` },
      paymentMethods: this.paymentMethodIds.map((id) => ({ id, customerId: this.id })),
    };
  }
}

export const aCustomer = (): CustomerBuilder => new CustomerBuilder();
