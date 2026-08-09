-- =============================================================================
-- Wallet Transfer Service - Database Schema
-- Used by Testcontainers to initialise a real PostgreSQL instance per test run
-- =============================================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Wallets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      VARCHAR(100)  NOT NULL,
    currency      VARCHAR(3)    NOT NULL,
    balance       NUMERIC(19,4) NOT NULL DEFAULT 0,
    status        VARCHAR(20)   NOT NULL DEFAULT 'active',  -- active | suspended | closed
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    version       BIGINT        NOT NULL DEFAULT 0,         -- optimistic lock

    CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0),
    CONSTRAINT chk_wallets_currency             CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_wallets_status               CHECK (status IN ('active', 'suspended', 'closed'))
);

CREATE INDEX idx_wallets_owner_id ON wallets(owner_id);
CREATE INDEX idx_wallets_currency ON wallets(currency);

-- ─── Transfers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    source_wallet_id     UUID          NOT NULL REFERENCES wallets(id),
    destination_wallet_id UUID         NOT NULL REFERENCES wallets(id),
    amount               NUMERIC(19,4) NOT NULL,
    currency             VARCHAR(3)    NOT NULL,
    status               VARCHAR(20)   NOT NULL DEFAULT 'pending', -- pending | success | failed | reversed
    reference            VARCHAR(255),
    failure_reason       TEXT,
    idempotency_key      VARCHAR(255)  NOT NULL CONSTRAINT uq_transfers_idempotency_key UNIQUE,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_transfers_amount_positive    CHECK (amount > 0),
    CONSTRAINT chk_transfers_currency           CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_transfers_status             CHECK (status IN ('pending', 'success', 'failed', 'reversed')),
    CONSTRAINT chk_transfers_different_wallets  CHECK (source_wallet_id != destination_wallet_id)
);

CREATE INDEX idx_transfers_source_wallet      ON transfers(source_wallet_id);
CREATE INDEX idx_transfers_destination_wallet ON transfers(destination_wallet_id);
CREATE INDEX idx_transfers_status             ON transfers(status);
CREATE INDEX idx_transfers_created_at         ON transfers(created_at);
CREATE INDEX idx_transfers_idempotency_key    ON transfers(idempotency_key);

-- ─── Idempotency Keys ────────────────────────────────────────────────────────
-- Separate table gives us faster lookups and cleaner expiry management
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key          VARCHAR(255)  PRIMARY KEY,
    transfer_id  UUID          NOT NULL REFERENCES transfers(id),
    request_hash VARCHAR(64)   NOT NULL,   -- SHA-256 of canonical request body
    response     JSONB,                    -- cached response payload
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_keys_transfer_id ON idempotency_keys(transfer_id);
CREATE INDEX idx_idempotency_keys_expires_at  ON idempotency_keys(expires_at);

-- ─── Transfer Events (Audit Trail) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_events (
    id           BIGSERIAL     PRIMARY KEY,
    transfer_id  UUID          NOT NULL REFERENCES transfers(id),
    event_type   VARCHAR(50)   NOT NULL,  -- CREATED | BALANCE_DEBITED | BALANCE_CREDITED | COMPLETED | FAILED
    payload      JSONB,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by   VARCHAR(100)  NOT NULL DEFAULT 'system'
);

CREATE INDEX idx_transfer_events_transfer_id ON transfer_events(transfer_id);
CREATE INDEX idx_transfer_events_event_type  ON transfer_events(event_type);
CREATE INDEX idx_transfer_events_created_at  ON transfer_events(created_at);

-- ─── Outbox (Transactional Outbox Pattern) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
    id           BIGSERIAL     PRIMARY KEY,
    aggregate_id UUID          NOT NULL,
    event_type   VARCHAR(100)  NOT NULL,
    payload      JSONB         NOT NULL,
    status       VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | published | failed
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    retry_count  INT           NOT NULL DEFAULT 0,

    CONSTRAINT chk_outbox_status CHECK (status IN ('pending', 'published', 'failed'))
);

CREATE INDEX idx_outbox_events_aggregate_id ON outbox_events(aggregate_id);
CREATE INDEX idx_outbox_events_status       ON outbox_events(status);

-- ─── Balance Snapshots (point-in-time audit) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS balance_snapshots (
    id           BIGSERIAL     PRIMARY KEY,
    wallet_id    UUID          NOT NULL REFERENCES wallets(id),
    transfer_id  UUID          NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    balance_before NUMERIC(19,4) NOT NULL,
    balance_after  NUMERIC(19,4) NOT NULL,
    delta          NUMERIC(19,4) NOT NULL,  -- signed: negative = debit
    snapshot_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_balance_snapshots_wallet_id   ON balance_snapshots(wallet_id);
CREATE INDEX idx_balance_snapshots_transfer_id ON balance_snapshots(transfer_id);
