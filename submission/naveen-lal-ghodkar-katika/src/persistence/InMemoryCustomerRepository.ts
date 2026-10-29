import type { CustomerRepository } from './CustomerRepository';

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly ids: Set<string>;

  constructor(customerIds: readonly string[]) {
    this.ids = new Set(customerIds);
  }

  async exists(customerId: string): Promise<boolean> {
    return this.ids.has(customerId);
  }
}
