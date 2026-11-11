
import Database from 'better-sqlite3';
import { Subscription } from '../models/Subscription';

export class SubscriptionRepository {
    constructor(private readonly db: Database.Database) {}

    create(subscription: Subscription): void {
        const statement = this.db.prepare(`
            INSERT INTO subscriptions (
                id,
                customer_id,
                plan,
                status,
                amount,
                currency,
                payment_method_id,
                trial_starts_at,
                trial_ends_at,
                created_at,
                updated_at
            )
            VALUES (
                       @id,
                       @customerId,
                       @plan,
                       @status,
                       @amount,
                       @currency,
                       @paymentMethodId,
                       @trialStartsAt,
                       @trialEndsAt,
                       @createdAt,
                       @updatedAt
                   )
        `);

        statement.run({
            id: subscription.id,
            customerId: subscription.customerId,
            plan: subscription.plan,
            status: subscription.status,
            amount: subscription.amount,
            currency: subscription.currency,
            paymentMethodId: subscription.paymentMethodId,
            trialStartsAt: subscription.trialStartsAt.toISOString(),
            trialEndsAt: subscription.trialEndsAt.toISOString(),
            createdAt: subscription.createdAt.toISOString(),
            updatedAt: subscription.updatedAt.toISOString()
        });
    }

    findById(id: string): Subscription | undefined {
        const row = this.db.prepare(
            'SELECT * FROM subscriptions WHERE id = ?'
        ).get(id) as Record<string, unknown> | undefined;

        return row ? this.mapRow(row) : undefined;
    }

    findByCustomerId(customerId: string): Subscription[] {
        const rows = this.db.prepare(
            'SELECT * FROM subscriptions WHERE customer_id = ?'
        ).all(customerId) as Record<string, unknown>[];

        return rows.map(row => this.mapRow(row));
    }

    updateStatus(id: string, status: Subscription['status']): void {
        const result = this.db.prepare(`
            UPDATE subscriptions
            SET status = ?, updated_at = ?
            WHERE id = ?
        `).run(status, new Date().toISOString(), id);

        if (result.changes === 0) {
            throw new Error(`Subscription not found: ${id}`);
        }
    }

    private mapRow(row: Record<string, unknown>): Subscription {
        return {
            id: String(row.id),
            customerId: String(row.customer_id),
            plan: row.plan as Subscription['plan'],
            status: row.status as Subscription['status'],
            amount: Number(row.amount),
            currency: String(row.currency),
            paymentMethodId: String(row.payment_method_id),
            trialStartsAt: new Date(String(row.trial_starts_at)),
            trialEndsAt: new Date(String(row.trial_ends_at)),
            createdAt: new Date(String(row.created_at)),
            updatedAt: new Date(String(row.updated_at))
        };
    }
}
