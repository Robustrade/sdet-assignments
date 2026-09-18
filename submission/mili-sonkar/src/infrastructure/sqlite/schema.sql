CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('trialing', 'active', 'past_due', 'canceled')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'succeeded', 'failed', 'refunded')
    ),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processing_status TEXT NOT NULL
);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL,
    old_state TEXT,
    new_state TEXT NOT NULL,
    event_type TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    subscription_id TEXT,
    response_status INTEGER,
    response_body TEXT,
    status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'complete')),
    created_at TEXT NOT NULL
);

CREATE TABLE reconciliation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_payment_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL
);