export class CustomerCatalog {
  private readonly customers: ReadonlySet<string>;

  constructor(
    customerIds: readonly string[] = [
      "cust_001",
      "cust_002",
      "cust_pro",
      "cust_invalid"
    ]
  ) {
    this.customers = new Set(customerIds);
  }

  exists(customerId: string): boolean {
    return this.customers.has(customerId);
  }
}