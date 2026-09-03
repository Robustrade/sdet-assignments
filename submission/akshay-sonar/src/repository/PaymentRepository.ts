import { Payment } from "../domain/Payment";
import { InMemoryRepository } from "./InMemoryRepository";

export class PaymentRepository extends InMemoryRepository<Payment> {
}