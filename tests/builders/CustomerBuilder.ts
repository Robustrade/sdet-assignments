export interface CustomerData {
  customerId: string;
  paymentMethodId: string;
}

export class CustomerBuilder {
  private data: CustomerData = {
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
  };

  withId(id: string): this {
    this.data.customerId = id;
    return this;
  }

  withPaymentMethod(id: string): this {
    this.data.paymentMethodId = id;
    return this;
  }

  build(): CustomerData {
    return { ...this.data };
  }
}