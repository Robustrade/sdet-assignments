import type { Customer, PaymentMethod } from '../../domain/types';
import type { Database } from '../Database';

interface CustomerRow {
  id: string;
  email: string;
  created_at: string;
}

interface PaymentMethodRow {
  id: string;
  customer_id: string;
  created_at: string;
}

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  insert(customer: Customer): void {
    this.db.run('INSERT INTO customers (id, email, created_at) VALUES (?, ?, ?)', [
      customer.id,
      customer.email,
      customer.createdAt,
    ]);
  }

  insertPaymentMethod(method: PaymentMethod): void {
    this.db.run('INSERT INTO payment_methods (id, customer_id, created_at) VALUES (?, ?, ?)', [
      method.id,
      method.customerId,
      method.createdAt,
    ]);
  }

  find(id: string): Customer | undefined {
    const row = this.db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id]);
    return row && { id: row.id, email: row.email, createdAt: row.created_at };
  }

  findPaymentMethod(id: string): PaymentMethod | undefined {
    const row = this.db.get<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ?', [id]);
    return row && { id: row.id, customerId: row.customer_id, createdAt: row.created_at };
  }
}
