
import { AppDatabase } from '../database/database';
import {
  Subscription,
  SubscriptionStatus
} from '../models/Subscription';

export class SubscriptionRepository {
  constructor(private db: AppDatabase) {}

  create(subscription: Subscription): void {
    this.db.run(
      `INSERT INTO subscriptions
       (id, customer_id, plan_id, status, cancel_at_period_end)
       VALUES (?, ?, ?, ?, ?)`,
      [
        subscription.id,
        subscription.customerId,
        subscription.planId,
        subscription.status,
        subscription.cancelAtPeriodEnd ? 1 : 0
      ]
    );
  }

  findById(id: string): Subscription | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM subscriptions WHERE id = ?`
    );

    try {
      statement.bind([id]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        id: row.id as string,
        customerId: row.customer_id as string,
        planId: row.plan_id as string,
        status: row.status as SubscriptionStatus,
        currentPeriodStart: row.current_period_start as string | undefined,
        currentPeriodEnd: row.current_period_end as string | undefined,
        cancelAtPeriodEnd: row.cancel_at_period_end === 1,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      };
    } finally {
      statement.free();
    }
  }

  updateStatus(
    id: string,
    status: SubscriptionStatus
  ): void {
    this.db.run(
      `UPDATE subscriptions
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, id]
    );

    if (this.db.getRowsModified() === 0) {
      throw new Error(`Subscription not found: ${id}`);
    }
  }
}
