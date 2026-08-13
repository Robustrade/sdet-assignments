import type { Db } from './db.js';
import type { PlanId, Subscription, SubscriptionState } from '../domain/types.js';

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  state: string;
  payment_method_id: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    customerId: row.customer_id,
    plan: row.plan as PlanId,
    state: row.state as SubscriptionState,
    paymentMethodId: row.payment_method_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SubscriptionRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): Subscription | undefined {
    const row = this.db
      .prepare('SELECT * FROM subscriptions WHERE id = ?')
      .get(id) as SubscriptionRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  upsert(subscription: Subscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, customer_id, plan, state, payment_method_id, created_at, updated_at)
         VALUES (@id, @customer_id, @plan, @state, @payment_method_id, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: subscription.id,
        customer_id: subscription.customerId,
        plan: subscription.plan,
        state: subscription.state,
        payment_method_id: subscription.paymentMethodId,
        created_at: subscription.createdAt,
        updated_at: subscription.updatedAt,
      });
  }

  all(): Subscription[] {
    const rows = this.db.prepare('SELECT * FROM subscriptions').all() as SubscriptionRow[];
    return rows.map(toDomain);
  }
}