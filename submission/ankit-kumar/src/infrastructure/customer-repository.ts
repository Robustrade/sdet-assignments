import { TestDatabase } from "./database";

export interface Customer {
  id: string;
  name: string;
}

export class CustomerRepository {
  constructor(private readonly database: TestDatabase) {}

  save(customer: Customer): void {
    this.database.run(
      "INSERT INTO customers (id, name) VALUES (?, ?)",
      [customer.id, customer.name]
    );
  }

  findById(id: string): Customer | undefined {
    const row = this.database.get<Customer>(
      "SELECT id, name FROM customers WHERE id = ?",
      [id]
    );

    return row;
  }
}