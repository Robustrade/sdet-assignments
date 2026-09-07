import { Store } from '../persistence/inMemoryRepository';
import { Customer } from '../domain/types';

export const DEFAULT_CUSTOMER_ID = 'cust_seed_001';

const SEED_CUSTOMERS: Customer[] = [
  { id: 'cust_seed_001', paymentMethodId: 'pm_test_visa_4242' },
  { id: 'cust_seed_002', paymentMethodId: 'pm_test_mastercard_5555' },
];

export class FixtureSeeder {
  static seedCustomers(store: Store): void {
    SEED_CUSTOMERS.forEach((customer) => store.customers.save(customer));
  }
}
