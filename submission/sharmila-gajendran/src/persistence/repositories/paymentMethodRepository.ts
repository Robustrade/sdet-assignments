import type { PaymentMethod } from '../../domain/types';
import type { Db } from '../database';

interface PaymentMethodRow {
  id: string;
  customer_id: string;
}

export class PaymentMethodRepository {
  constructor(private readonly db: Db) {}

  insert(paymentMethod: PaymentMethod): void {
    this.db
      .prepare('INSERT INTO payment_methods (id, customer_id) VALUES (@id, @customerId)')
      .run({ id: paymentMethod.id, customerId: paymentMethod.customerId });
  }

  findById(id: string): PaymentMethod | undefined {
    const row = this.db.prepare('SELECT id, customer_id FROM payment_methods WHERE id = @id').get({ id }) as
      | PaymentMethodRow
      | undefined;
    return row ? { id: row.id, customerId: row.customer_id } : undefined;
  }
}
