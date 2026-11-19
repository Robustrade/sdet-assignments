import { Db } from '../db/database';
import { AuditTrigger, SubscriptionEvent, SubscriptionStatus } from '../domain/types';

const COLUMNS = `id, subscription_id AS subscriptionId, sequence, previous_status AS previousStatus,
  new_status AS newStatus, trigger, reference_id AS referenceId, created_at AS createdAt`;

/** Append-only audit history: one row per subscription state change. */
export class SubscriptionEventRepository {
  constructor(private readonly db: Db) {}

  append(entry: {
    id: string;
    subscriptionId: string;
    previousStatus: SubscriptionStatus | null;
    newStatus: SubscriptionStatus;
    trigger: AuditTrigger;
    referenceId: string | null;
    createdAt: string;
  }): void {
    const { next } = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM subscription_events WHERE subscription_id = ?')
      .get(entry.subscriptionId) as { next: number };
    this.db
      .prepare(
        `INSERT INTO subscription_events (id, subscription_id, sequence, previous_status, new_status, trigger,
           reference_id, created_at)
         VALUES (@id, @subscriptionId, @sequence, @previousStatus, @newStatus, @trigger, @referenceId, @createdAt)`,
      )
      .run({ ...entry, sequence: next });
  }

  findBySubscription(subscriptionId: string): SubscriptionEvent[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM subscription_events WHERE subscription_id = ? ORDER BY sequence`)
      .all(subscriptionId) as SubscriptionEvent[];
  }
}
