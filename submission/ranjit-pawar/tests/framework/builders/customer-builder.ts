import type { CustomerRecord } from '../../../src/persistence/records';

export class CustomerBuilder {
  private record: CustomerRecord = {
    id: 'cust_001',
    email: 'ada@example.com',
    payment_method_ids: ['pm_test_visa_4242'],
    created_at: new Date('2025-12-01T00:00:00.000Z').toISOString()
  };

  static aCustomer(): CustomerBuilder {
    return new CustomerBuilder();
  }

  withId(id: string): this {
    this.record.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.record.email = email;
    return this;
  }

  withPaymentMethods(...ids: string[]): this {
    this.record.payment_method_ids = ids;
    return this;
  }

  withoutPaymentMethods(): this {
    this.record.payment_method_ids = [];
    return this;
  }

  build(): CustomerRecord {
    return structuredClone(this.record);
  }
}
