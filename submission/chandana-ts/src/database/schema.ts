
export const schema = `
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
    status TEXT NOT NULL CHECK (
      status IN ('trialing', 'active', 'past_due', 'canceled')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    canceled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  transaction_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
  );
`;
