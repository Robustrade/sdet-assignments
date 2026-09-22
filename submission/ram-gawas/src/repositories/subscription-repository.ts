import Database from 'better-sqlite3';
import { SubscriptionState } from '../subscription-state';

export interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  state: SubscriptionState;
  paymentMethodId: string;
  trialEndsAt?: string;
}

export class SubscriptionRepository {
  constructor(private db: Database.Database) {}

  save(subscription: Subscription): void {
    const statement = this.db.prepare(`
      INSERT INTO subscriptions (
        id,
        customer_id,
        plan,
        state,
        payment_method_id,
        trial_ends_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      subscription.id,
      subscription.customerId,
      subscription.plan,
      subscription.state,
      subscription.paymentMethodId,
      subscription.trialEndsAt ?? null,
      new Date().toISOString(),
    );
  }

  findById(id: string): Subscription | undefined {
    const row = this.db
      .prepare(`
        SELECT *
        FROM subscriptions
        WHERE id = ?
      `)
      .get(id) as any;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      customerId: row.customer_id,
      plan: row.plan,
      state: row.state,
      paymentMethodId: row.payment_method_id,
      ...(row.trial_ends_at != null
        ? { trialEndsAt: row.trial_ends_at }
        : {}),
    };
  }

  updateState(id: string, state: SubscriptionState): void {
    this.db
      .prepare(`
        UPDATE subscriptions
        SET state = ?
        WHERE id = ?
      `)
      .run(state, id);
  }
}
