
import type BetterSqlite3 from 'better-sqlite3';

export interface Customer {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export class CustomerRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  create(customer: {
    id: string;
    name: string;
    email: string;
  }): Customer {
    const statement = this.db.prepare(`
      INSERT INTO customers (id, name, email)
      VALUES (?, ?, ?)
    `);

    statement.run(
      customer.id,
      customer.name,
      customer.email
    );

    const createdCustomer = this.findById(customer.id);

    if (!createdCustomer) {
      throw new Error('Customer creation failed');
    }

    return createdCustomer;
  }

  findById(id: string): Customer | null {
    const statement = this.db.prepare(`
      SELECT id, name, email, created_at
      FROM customers
      WHERE id = ?
    `);

    const customer = statement.get(id) as Customer | undefined;

    return customer ?? null;
  }

  findByEmail(email: string): Customer | null {
    const statement = this.db.prepare(`
      SELECT id, name, email, created_at
      FROM customers
      WHERE email = ?
    `);

    const customer = statement.get(email) as Customer | undefined;

    return customer ?? null;
  }
}
