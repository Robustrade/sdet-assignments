import type { Customer } from '../../../src/domain/types';

let seq = 0;

/** PATTERN: Builder (test data). */
export class CustomerBuilder {
  private customer: Customer;
  constructor() {
    seq++;
    this.customer = {
      id: `cust_${String(seq).padStart(3, '0')}`,
      email: `customer${seq}@example.test`,
      paymentMethodIds: ['pm_test_visa_4242'],
    };
  }
  withId(id: string): this {
    this.customer.id = id;
    return this;
  }
  withPaymentMethods(...ids: string[]): this {
    this.customer.paymentMethodIds = ids;
    return this;
  }
  build(): Customer {
    return structuredClone(this.customer);
  }
}
export const aCustomer = () => new CustomerBuilder();
