
import { AppDatabase } from '../database/database';
import { Customer } from '../models/Customer';

export class CustomerRepository {
  constructor(private db: AppDatabase) {}

  create(customer: Customer): void {
    this.db.run(
      `INSERT INTO customers (id, email)
       VALUES (?, ?)`,
      [customer.id, customer.email]
    );
  }

  findById(id: string): Customer | undefined {
    const statement = this.db.prepare(
      `SELECT id, email, created_at
       FROM customers
       WHERE id = ?`
    );

    try {
      statement.bind([id]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as {
        id: string;
        email: string;
        created_at: string;
      };

      return {
        id: row.id,
        email: row.email,
        createdAt: row.created_at
      };
    } finally {
      statement.free();
    }
  }

  findByEmail(email: string): Customer | undefined {
    const statement = this.db.prepare(
      `SELECT id, email, created_at
       FROM customers
       WHERE email = ?`
    );

    try {
      statement.bind([email.toLowerCase().trim()]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as {
        id: string;
        email: string;
        created_at: string;
      };

      return {
        id: row.id,
        email: row.email,
        createdAt: row.created_at
      };
    } finally {
      statement.free();
    }
  }
}
