/**
 * Customer repository backed by SQLite (sql.js).
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import type { CustomerRecord } from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export class CustomerRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public insert(customer: CustomerRecord): void {
    this.db.run(
      'INSERT INTO customers (id, email, name, created_at) VALUES (?, ?, ?, ?)',
      [customer.id, customer.email, customer.name, customer.created_at],
    );
  }

  public findById(id: string): CustomerRecord | null {
    const row = this.db.queryOne<Record<string, SqlValue>>(
      'SELECT id, email, name, created_at FROM customers WHERE id = ?',
      [id],
    );
    return (row as unknown as CustomerRecord | null);
  }
}
