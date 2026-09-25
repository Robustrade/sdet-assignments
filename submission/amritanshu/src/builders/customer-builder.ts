import type { Customer } from "../domain/customer.js";

export class CustomerBuilder {
  private customer: Customer = {
    id: "cust_001",
    name: "Test Customer",
    email: "customer@example.com",
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