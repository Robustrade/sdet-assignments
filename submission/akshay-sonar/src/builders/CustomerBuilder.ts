export interface Customer {
  id: string;
  email: string;
  name: string;
}

export class CustomerBuilder {
  private customer: Customer = {
    id: `customer_${Date.now()}`,
    email: "test@example.com",
    name: "Test Customer",
  };

  withId(id: string): this {
    this.customer.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.customer.email = email;
    return this;
  }

  withName(name: string): this {
    this.customer.name = name;
    return this;
  }

  build(): Customer {
    return { ...this.customer };
  }
}