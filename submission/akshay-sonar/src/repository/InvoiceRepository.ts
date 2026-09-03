import { Invoice } from "../domain/Invoice";
import { InMemoryRepository } from "./InMemoryRepository";

export class InvoiceRepository extends InMemoryRepository<Invoice> {
}