import { InMemoryDatabase } from "./InMemoryDatabase";
import { Subscription } from "../domain/Subscription";

/**
 * Repository pattern (the "one more pattern" required by the assignment). Two consumers:
 *
 *  1. SubscriptionService uses it instead of touching InMemoryDatabase.subscriptions directly.
 *  2. The test suite's assertion layer (test/support) uses the SAME repository to read back
 *     persisted state, instead of "raw queries scattered through tests" (a phrase used
 *     verbatim in the assignment as something to avoid). If the storage engine changes later
 *     (e.g. swapped for better-sqlite3), only this class and InMemoryDatabase change -- no
 *     test file does.
 */
export class SubscriptionRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  save(subscription: Subscription): void {
    this.db.subscriptions.set(subscription.id, subscription);
  }

  findById(id: string): Subscription | undefined {
    return this.db.subscriptions.get(id);
  }

  exists(id: string): boolean {
    return this.db.subscriptions.has(id);
  }

  all(): Subscription[] {
    return Array.from(this.db.subscriptions.values());
  }
}
