import { one, type Db } from './database';

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  exists(customerId: string): boolean {
    return one(this.db, 'SELECT 1 FROM customers WHERE id = ?', customerId) !== undefined;
  }

  paymentMethodBelongsTo(paymentMethodId: string, customerId: string): boolean {
    return (
      one(this.db, 'SELECT 1 FROM payment_methods WHERE id = ? AND customer_id = ?', paymentMethodId, customerId) !==
      undefined
    );
  }
}
