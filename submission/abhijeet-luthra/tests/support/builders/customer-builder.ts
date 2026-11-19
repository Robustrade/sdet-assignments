import { Customer } from '../../../src/domain/types';

let customerCounter = 0;

/** Builds extra customers for scenarios that need more than the seeded ones. */
export class CustomerBuilder {
  private readonly n = ++customerCounter;
  private customer: Customer = {
    id: `cust_built_${this.n}`,
    name: `Built Customer ${this.n}`,
    email: `built${this.n}@example.test`,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  withId(id: string): this {
    this.customer.id = id;
    return this;
  }

  build(): Customer {
    return { ...this.customer };
  }
}

export const aCustomer = (): CustomerBuilder => new CustomerBuilder();
