import type { Customer } from '../../domain/types';
import type { Db } from '../database';

interface CustomerRow {
  id: string;
  email: string;
}

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  insert(customer: Customer): void {
    this.db
      .prepare('INSERT INTO customers (id, email) VALUES (@id, @email)')
      .run({ id: customer.id, email: customer.email });
  }

  findById(id: string): Customer | undefined {
    const row = this.db.prepare('SELECT id, email FROM customers WHERE id = @id').get({ id }) as CustomerRow | undefined;
    return row ? { id: row.id, email: row.email } : undefined;
  }
}
