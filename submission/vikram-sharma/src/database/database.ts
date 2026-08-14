const Database: any = require("better-sqlite3");

export const db = new Database(":memory:");

db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    payment_method_id TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);
`);