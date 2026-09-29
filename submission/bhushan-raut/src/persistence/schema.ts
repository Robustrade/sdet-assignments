/**
 * The database enforces what it can: CHECK-constrained statuses, UNIQUE idempotency
 * keys and a primary key on event_id. Application-level idempotency is backed by
 * these, so even a logic bug cannot persist a duplicate charge or event.
 */
export const SCHEMA = `
CREATE TABLE customers (
  id TEXT PRIMARY KEY
);

CREATE TABLE payment_methods (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id)
);

CREATE TABLE subscriptions (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  plan               TEXT NOT NULL,
  payment_method_id  TEXT NOT NULL REFERENCES payment_methods(id),
  status             TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at      TEXT NOT NULL,
  current_period_end TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  canceled_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'paid', 'failed', 'refunded')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE payment_attempts (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id),
  attempt_no      INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_ref    TEXT,
  decline_code    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (invoice_id, attempt_no)
);

CREATE TABLE webhook_events (
  event_id          TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  subscription_id   TEXT,
  invoice_id        TEXT,
  payload           TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  delivery_count    INTEGER NOT NULL DEFAULT 1,
  first_received_at TEXT NOT NULL,
  last_received_at  TEXT NOT NULL
);

CREATE TABLE subscription_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  trigger         TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('api', 'webhook', 'billing')),
  reference       TEXT,
  at              TEXT NOT NULL
);
`;
