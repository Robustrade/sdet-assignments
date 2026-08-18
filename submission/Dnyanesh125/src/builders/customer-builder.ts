export interface Customer {
  id: string;
  name: string;
  email: string;
}

export class CustomerBuilder {
  private customer: Customer = {
    id: `cust_${Date.now()}`,
    name: 'Test Customer',
    email: 'test.customer@example.com',
  };

  withId(id: string): this {
    this.customer.id = id;
    return this;
  }

  withName(name: string): this {
    this.customer.name = name;
    return this;
  }

  withEmail(email: string): this {
    this.customer.email = email;
    return this;
  }

  build(): Customer {
    return { ...this.customer };
  }
}
