import crypto from 'node:crypto';
import { CustomerRecord } from '../../../src/types';

/**
 * Fluent builder for CustomerRecord fixtures with test-independent IDs.
 */
export class CustomerBuilder {
  private id = `cust_${crypto.randomUUID().slice(0, 8)}`;
  private email = `${this.id}@example.com`;
  private name = `Test Customer ${this.id}`;
  private paymentMethods: string[] = ['pm_test_visa_4242'];

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  withName(name: string): this {
    this.name = name;
    return this;
  }

  withPaymentMethods(...methods: string[]): this {
    this.paymentMethods = methods;
    return this;
  }

  build(): CustomerRecord {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      payment_methods: [...this.paymentMethods],
      created_at: new Date().toISOString()
    };
  }
}

export function aCustomer(): CustomerBuilder {
  return new CustomerBuilder();
}
