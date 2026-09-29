let customerSeq = 0;

export interface CustomerSeed {
  readonly id: string;
  readonly paymentMethodId: string;
}

export class CustomerBuilder {
  private readonly seq = ++customerSeq;
  private id = `cust_test_${this.seq}`;
  private paymentMethodId = `pm_test_visa_${this.seq}`;

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  build(): CustomerSeed {
    return { id: this.id, paymentMethodId: this.paymentMethodId };
  }
}

export const aCustomer = () => new CustomerBuilder();
