import type { DatabaseSync } from 'node:sqlite';
import type { Subscription, Plan } from '../../domain/Subscription.js';
import type { SubscriptionState } from '../../domain/SubscriptionState.js';

interface SubscriptionRow {
    id: string;
    customer_id: string;
    plan: Plan;
    status: SubscriptionState;
    created_at: string;
    updated_at: string;
}

export class SubscriptionRepository {
    constructor(private readonly db: DatabaseSync) { }

    create(subscription: Subscription): void {
        this.db
            .prepare(`
        INSERT INTO subscriptions (
          id,
          customer_id,
          plan,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
            .run(
                subscription.id,
                subscription.customerId,
                subscription.plan,
                subscription.status,
                subscription.createdAt,
                subscription.updatedAt
            );
    }

    getById(id: string): Subscription | undefined {
        const row = this.db
            .prepare(`
        SELECT
          id,
          customer_id,
          plan,
          status,
          created_at,
          updated_at
        FROM subscriptions
        WHERE id = ?
      `)
            .get(id) as SubscriptionRow | undefined;

        return row ? this.toDomain(row) : undefined;
    }

    getByCustomerId(customerId: string): Subscription[] {
        const rows = this.db
            .prepare(`SELECT
          id,
          customer_id,
          plan,
          status,
          created_at,
          updated_at
        FROM subscriptions
        WHERE customer_id = ?
        ORDER BY created_at
      `)
            .all(customerId) as unknown as SubscriptionRow[];

        return rows.map((row) => this.toDomain(row));
    }

    updateStatus(
        id: string,
        status: SubscriptionState,
        updatedAt: string
    ): void {
        this.db
            .prepare(`
        UPDATE subscriptions
        SET
          status = ?,
          updated_at = ?
        WHERE id = ?
      `)
            .run(status, updatedAt, id);
    }

    private toDomain(row: SubscriptionRow): Subscription {
        return {
            id: row.id,
            customerId: row.customer_id,
            plan: row.plan,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}