import type { Customer } from "../domain/customer.js";

export interface CustomerRepository {
  save(customer: Customer): void;
  findById(id: string): Customer | undefined;
}