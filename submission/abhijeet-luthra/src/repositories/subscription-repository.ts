import { Db } from '../db/database';
import { Subscription } from '../domain/types';

const COLUMNS = `id, customer_id AS customerId, plan_id AS planId, payment_method_id AS paymentMethodId,
  status, trial_end AS trialEnd, current_period_end AS currentPeriodEnd, created_at AS createdAt,
  updated_at AS updatedAt, canceled_at AS canceledAt`;

export class SubscriptionRepository {
  constructor(private readonly db: Db) {}

  insert(s: Subscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, payment_method_id, status, trial_end,
           current_period_end, created_at, updated_at, canceled_at)
         VALUES (@id, @customerId, @planId, @paymentMethodId, @status, @trialEnd,
           @currentPeriodEnd, @createdAt, @updatedAt, @canceledAt)`,
      )
      .run(s);
  }

  /** Persists the mutable fields. Status changes must be decided by the state machine first. */
  update(s: Subscription): void {
    this.db
      .prepare(
        `UPDATE subscriptions SET status = @status, current_period_end = @currentPeriodEnd,
           updated_at = @updatedAt, canceled_at = @canceledAt WHERE id = @id`,
      )
      .run(s);
  }

  findById(id: string): Subscription | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM subscriptions WHERE id = ?`).get(id) as Subscription | undefined;
  }

  findAll(): Subscription[] {
    return this.db.prepare(`SELECT ${COLUMNS} FROM subscriptions ORDER BY id`).all() as Subscription[];
  }
}
