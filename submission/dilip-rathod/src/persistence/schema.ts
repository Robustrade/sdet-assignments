import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine';

export const SCHEMA_SQL = `
CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE payment_methods (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE subscriptions (
  id                   TEXT PRIMARY KEY,
  customer_id          TEXT NOT NULL REFERENCES customers(id),
  payment_method_id    TEXT NOT NULL REFERENCES payment_methods(id),
  plan                 TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at        TEXT,
  current_period_start TEXT,
  current_period_end   TEXT,
  next_billing_at      TEXT,
  retry_count          INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  canceled_at          TEXT,
  cancel_reason        TEXT CHECK (cancel_reason IN ('customer_request', 'retries_exhausted')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CHECK ((status = 'canceled') = (cancel_reason IS NOT NULL)),
  CHECK (status <> 'canceled' OR next_billing_at IS NULL)
);

-- Populated from SubscriptionStateMachine so the TypeScript table stays the single source of truth.
CREATE TABLE allowed_status_transitions (
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

CREATE TRIGGER subscriptions_initial_status
BEFORE INSERT ON subscriptions
WHEN NEW.status <> '${SubscriptionStateMachine.initialStatus}'
BEGIN
  SELECT RAISE(ABORT, 'subscriptions must be created in the initial status');
END;

CREATE TRIGGER subscriptions_enforce_lifecycle
BEFORE UPDATE OF status ON subscriptions
WHEN OLD.status <> NEW.status AND NOT EXISTS (
  SELECT 1 FROM allowed_status_transitions WHERE from_status = OLD.status AND to_status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'illegal subscription status transition');
END;

CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  plan            TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'paid', 'uncollectible', 'void', 'refunded')),
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  paid_at         TEXT,
  closed_at       TEXT,
  CHECK (period_end > period_start),
  CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX invoices_one_open_per_subscription ON invoices(subscription_id) WHERE status = 'open';
CREATE UNIQUE INDEX invoices_one_per_period ON invoices(subscription_id, period_start);

CREATE TABLE payment_attempts (
  id                 TEXT PRIMARY KEY,
  invoice_id         TEXT NOT NULL REFERENCES invoices(id),
  attempt_number     INTEGER NOT NULL CHECK (attempt_number >= 1),
  idempotency_key    TEXT NOT NULL UNIQUE,
  amount             INTEGER NOT NULL CHECK (amount > 0),
  status             TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'declined', 'timed_out')),
  provider_charge_id TEXT,
  decline_code       TEXT,
  resolved_by        TEXT CHECK (resolved_by IN ('provider_response', 'webhook')),
  created_at         TEXT NOT NULL,
  resolved_at        TEXT,
  UNIQUE (invoice_id, attempt_number),
  CHECK ((status IN ('succeeded', 'declined')) = (resolved_at IS NOT NULL)),
  CHECK ((status = 'declined') = (decline_code IS NOT NULL))
);

CREATE TABLE webhook_events (
  event_id        TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  subscription_id TEXT,
  invoice_id      TEXT,
  payload         TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('applied', 'ignored')),
  reason          TEXT,
  received_at     TEXT NOT NULL,
  CHECK ((outcome = 'ignored') = (reason IS NOT NULL))
);

CREATE TABLE webhook_deliveries (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL REFERENCES webhook_events(event_id),
  received_at  TEXT NOT NULL,
  is_duplicate INTEGER NOT NULL CHECK (is_duplicate IN (0, 1))
);

CREATE TABLE audit_log (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  event_type      TEXT NOT NULL CHECK (event_type IN
                    ('created', 'status_changed', 'renewed', 'retry_failed', 'plan_changed', 'invoice_refunded')),
  from_status     TEXT,
  to_status       TEXT,
  cause           TEXT,
  reference       TEXT,
  detail          TEXT,
  created_at      TEXT NOT NULL
);

-- Outbox for customer-facing side effects (emails). Must never be written twice for one fact.
CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  kind            TEXT NOT NULL CHECK (kind IN
                    ('subscription_activated', 'payment_failed', 'subscription_canceled', 'payment_refunded')),
  reference       TEXT,
  created_at      TEXT NOT NULL
);
`;

export function transitionSeedSql(): string {
  const values = SubscriptionStateMachine.statusEdges()
    .map(([from, to]) => `('${from}', '${to}')`)
    .join(', ');
  return `INSERT INTO allowed_status_transitions (from_status, to_status) VALUES ${values};`;
}

export const EXPECTED_TABLES = [
  'allowed_status_transitions',
  'audit_log',
  'customers',
  'invoices',
  'notifications',
  'payment_attempts',
  'payment_methods',
  'subscriptions',
  'webhook_deliveries',
  'webhook_events',
] as const;
