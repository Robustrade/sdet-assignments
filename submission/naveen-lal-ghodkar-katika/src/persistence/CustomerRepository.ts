export interface CustomerRepository {
  exists(customerId: string): Promise<boolean>;
}
