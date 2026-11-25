
import type BetterSqlite3 from 'better-sqlite3';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export interface Subscription {
  id: string;
  customer_id: string;
  plan_id: string;
  payment_method_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubscriptionInput {
  id: string;
  customer_id: string;
  plan_id: string;
  payment_method_id: string;
  status: SubscriptionStatus;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
}

export class SubscriptionRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  create(input: CreateSubscriptionInput): Subscription {
    this.db.prepare(`
      INSERT INTO subscriptions (
        id,
        customer_id,
        plan_id,
        payment_method_id,
        status,
        trial_ends_at,
        current_period_start,
        current_period_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.customer_id,
      input.plan_id,
      input.payment_method_id,
      input.status,
      input.trial_ends_at ?? null,
      input.current_period_start ?? null,
      input.current_period_end ?? null
    );

    const subscription = this.findById(input.id);

    if (!subscription) {
      throw new Error('Subscription creation failed');
    }

    return subscription;
  }

  findById(id: string): Subscription | null {
    const subscription = this.db.prepare(`
      SELECT *
      FROM subscriptions
      WHERE id = ?
    `).get(id) as Subscription | undefined;

    return subscription ?? null;
  }

  findByCustomerId(customerId: string): Subscription[] {
    return this.db.prepare(`
      SELECT *
      FROM subscriptions
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).all(customerId) as Subscription[];
  }

  updateStatus(
    id: string,
    status: SubscriptionStatus
  ): Subscription {
    const result = this.db.prepare(`
      UPDATE subscriptions
      SET status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);

    if (result.changes === 0) {
      throw new Error(`Subscription not found: ${id}`);
    }

    const subscription = this.findById(id);

    if (!subscription) {
      throw new Error('Subscription update failed');
    }

    return subscription;
  }

  cancel(id: string, canceledAt: string): Subscription {
    const result = this.db.prepare(`
      UPDATE subscriptions
      SET status = 'canceled',
          canceled_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(canceledAt, id);

    if (result.changes === 0) {
      throw new Error(`Subscription not found: ${id}`);
    }

    const subscription = this.findById(id);

    if (!subscription) {
      throw new Error('Subscription cancellation failed');
    }

    return subscription;
  }
}
