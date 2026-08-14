import { db } from "../database/database";
import { Subscription } from "../domain/Subscription";

export class SubscriptionRepository {

    save(subscription: Subscription): void {

        const statement = db.prepare(`
            INSERT INTO subscriptions
            (
                id,
                customer_id,
                plan,
                payment_method_id,
                status
            )
            VALUES
            (
                ?,
                ?,
                ?,
                ?,
                ?
            )
        `);

        statement.run(
            subscription.id,
            subscription.customerId,
            subscription.plan,
            subscription.paymentMethodId,
            subscription.status
        );

    }

    findById(id: string): Subscription | null {
        const stmt = db.prepare(`SELECT * FROM subscriptions WHERE id = ?`);
        const row = stmt.get(id);
        if (!row) return null;
        return new Subscription(row.id, row.customer_id, row.plan, row.payment_method_id, row.status);
    }

    updateStatus(id: string, status: string) {
        const stmt = db.prepare(`UPDATE subscriptions SET status = ? WHERE id = ?`);
        stmt.run(status, id);
    }

}