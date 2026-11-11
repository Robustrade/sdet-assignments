
import Database from 'better-sqlite3';

export function createDatabase(
    filename: string = ':memory:'
): Database.Database {
    const db = new Database(filename);

    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
            status TEXT NOT NULL CHECK (
                status IN ('trialing', 'active', 'past_due', 'canceled')
            ),
            amount REAL NOT NULL CHECK (amount >= 0),
            currency TEXT NOT NULL,
            payment_method_id TEXT NOT NULL,
            trial_starts_at TEXT NOT NULL,
            trial_ends_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS processed_webhook_events (
            event_id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            processed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invoice_payment_status (
                invoice_id TEXT PRIMARY KEY,
                subscription_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                        status IN ('succeeded', 'failed', 'refunded')
                ),
                updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id
        ON subscriptions(customer_id);
    `);

    return db;
}