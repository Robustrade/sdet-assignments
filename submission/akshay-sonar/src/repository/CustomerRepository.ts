import { Customer } from "../builders/CustomerBuilder";
import { InMemoryRepository } from "./InMemoryRepository";

export class CustomerRepository extends InMemoryRepository<Customer> {
}