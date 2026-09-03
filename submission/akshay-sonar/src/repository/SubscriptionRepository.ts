import { Subscription } from "../domain/Subscription";
import { InMemoryRepository } from "./InMemoryRepository";

export class SubscriptionRepository extends InMemoryRepository<Subscription> {
}