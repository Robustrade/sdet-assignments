import { randomUUID } from 'crypto';

export interface TestCustomer {
  id: string;
  paymentMethodId: string;
}

export class CustomerBuilder {
  private id = `cust_${randomUUID().slice(0, 8)}`;
  private paymentMethodId = 'pm_test_visa_4242';

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withPaymentMethod(pm: string): this {
    this.paymentMethodId = pm;
    return this;
  }

  build(): TestCustomer {
    return { id: this.id, paymentMethodId: this.paymentMethodId };
  }
}
