-- Subscription & Billing fixture schema (SQLite).
-- Constraints here are part of the correctness story, not decoration:
-- several of them are what actually stop duplicates under redelivery or races.

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE payment_methods (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  brand        TEXT NOT NULL,
  last4        TEXT NOT NULL CHECK (length(last4) = 4),
  status       TEXT NOT NULL CHECK (status IN ('active', 'expired'))
);

CREATE TABLE subscriptions (
  id                    TEXT PRIMARY KEY,
  customer_id           TEXT NOT NULL REFERENCES customers(id),
  plan                  TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
  status                TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  payment_method_id     TEXT NOT NULL REFERENCES payment_methods(id),
  price_cents           INTEGER NOT NULL CHECK (price_cents > 0),
  currency              TEXT NOT NULL CHECK (currency = 'USD'),
  trial_ends_at         TEXT,
  current_period_start  TEXT NOT NULL,
  current_period_end    TEXT NOT NULL,
  canceled_at           TEXT,
  cancel_reason         TEXT,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL)
);

CREATE TABLE invoices (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL CHECK (currency = 'USD'),
  status           TEXT NOT NULL CHECK (status IN ('open', 'paid', 'uncollectible', 'void', 'refunded')),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  failed_attempts  INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  next_retry_at    TEXT,
  paid_at          TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- one invoice per billing period: a second billing run cannot bill the same period twice
  UNIQUE (subscription_id, period_start),
  CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL))
);

CREATE TABLE charge_attempts (
  id                  TEXT PRIMARY KEY,
  invoice_id          TEXT NOT NULL REFERENCES invoices(id),
  attempt_no          INTEGER NOT NULL CHECK (attempt_no >= 1),
  idempotency_key     TEXT NOT NULL UNIQUE,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  status              TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'declined', 'unknown')),
  provider_charge_id  TEXT UNIQUE,
  failure_reason      TEXT,
  created_at          TEXT NOT NULL,
  settled_at          TEXT,
  UNIQUE (invoice_id, attempt_no)
);

CREATE TABLE webhook_events (
  event_id         TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('payment.succeeded', 'payment.failed', 'payment.refunded')),
  subscription_id  TEXT NOT NULL,
  invoice_id       TEXT NOT NULL,
  payload          TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('processed', 'ignored')),
  reason           TEXT,
  received_at      TEXT NOT NULL,
  CHECK ((outcome = 'ignored') = (reason IS NOT NULL))
);

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  seq              INTEGER NOT NULL CHECK (seq >= 1),
  action           TEXT NOT NULL,
  from_status      TEXT,
  to_status        TEXT,
  source           TEXT NOT NULL CHECK (source IN ('api', 'webhook', 'billing')),
  reference        TEXT,
  at               TEXT NOT NULL,
  prev_hash        TEXT NOT NULL,
  hash             TEXT NOT NULL UNIQUE,
  UNIQUE (subscription_id, seq)
);

CREATE TABLE notifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  kind             TEXT NOT NULL,
  reference        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  -- a side effect is keyed by what caused it, so replays cannot send it twice
  UNIQUE (kind, reference)
);

CREATE TABLE idempotency_keys (
  key              TEXT PRIMARY KEY,
  request_hash     TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX idx_attempts_invoice ON charge_attempts(invoice_id);
CREATE INDEX idx_webhook_events_subscription ON webhook_events(subscription_id);
CREATE INDEX idx_audit_subscription ON audit_log(subscription_id, seq);
