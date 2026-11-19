/**
 * SQLite schema (docs/DATABASE_DESIGN.md §3). Business rules that SQLite can
 * express are enforced here as CHECK / UNIQUE / FOREIGN KEY constraints, so bad
 * data is refused by the database itself - not just by service code.
 */
export const SCHEMA_SQL = `
CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE plans (
  id                     TEXT PRIMARY KEY,
  price_minor            INTEGER NOT NULL CHECK (price_minor >= 0),
  currency               TEXT NOT NULL,
  trial_days             INTEGER NOT NULL CHECK (trial_days >= 0),
  billing_interval_days  INTEGER NOT NULL CHECK (billing_interval_days > 0)
);

CREATE TABLE subscriptions (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customers(id),
  plan_id             TEXT NOT NULL REFERENCES plans(id),
  payment_method_id   TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  trial_end           TEXT NOT NULL,
  current_period_end  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  canceled_at         TEXT,
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL))
);

CREATE TABLE invoices (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  amount_minor     INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency         TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('open','paid','void','refunded')),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);

CREATE TABLE payments (
  id                  TEXT PRIMARY KEY,
  invoice_id          TEXT NOT NULL REFERENCES invoices(id),
  subscription_id     TEXT NOT NULL REFERENCES subscriptions(id),
  attempt_number      INTEGER NOT NULL CHECK (attempt_number >= 1),
  idempotency_key     TEXT NOT NULL UNIQUE,
  provider_reference  TEXT UNIQUE,
  amount_minor        INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency            TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','timed_out','refunded')),
  failure_code        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (invoice_id, attempt_number)
);

CREATE TABLE webhook_events (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  subscription_id     TEXT NOT NULL REFERENCES subscriptions(id),
  invoice_id          TEXT NOT NULL REFERENCES invoices(id),
  provider_reference  TEXT,
  payload             TEXT NOT NULL,
  processing_status   TEXT NOT NULL CHECK (processing_status IN ('processed','ignored','quarantined')),
  ignore_reason       TEXT,
  matched_payment_id  TEXT REFERENCES payments(id),
  delivery_count      INTEGER NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  first_received_at   TEXT NOT NULL,
  last_received_at    TEXT NOT NULL,
  CHECK ((processing_status = 'processed') = (ignore_reason IS NULL))
);

CREATE TABLE subscription_events (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  sequence         INTEGER NOT NULL CHECK (sequence >= 1),
  previous_status  TEXT,
  new_status       TEXT NOT NULL CHECK (new_status IN ('trialing','active','past_due','canceled')),
  trigger          TEXT NOT NULL,
  reference_id     TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (subscription_id, sequence)
);

CREATE TABLE idempotency_keys (
  key              TEXT PRIMARY KEY,
  request_hash     TEXT NOT NULL,
  subscription_id  TEXT NOT NULL UNIQUE REFERENCES subscriptions(id),
  created_at       TEXT NOT NULL
);
`;

export const TABLE_NAMES = [
  'customers',
  'plans',
  'subscriptions',
  'invoices',
  'payments',
  'webhook_events',
  'subscription_events',
  'idempotency_keys',
] as const;
