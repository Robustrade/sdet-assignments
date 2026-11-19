import { Db } from '../db/database';
import { Customer } from '../domain/types';

const COLUMNS = 'id, name, email, created_at AS createdAt';

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  insert(customer: Customer): void {
    this.db
      .prepare('INSERT INTO customers (id, name, email, created_at) VALUES (@id, @name, @email, @createdAt)')
      .run(customer);
  }

  findById(id: string): Customer | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM customers WHERE id = ?`).get(id) as Customer | undefined;
  }
}
