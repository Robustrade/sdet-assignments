CREATE TABLE IF NOT EXISTS wallets (
    id          VARCHAR(64)    PRIMARY KEY,
    owner_name  VARCHAR(255)   NOT NULL,
    balance     NUMERIC(19, 4) NOT NULL DEFAULT 0,
    currency    VARCHAR(10)    NOT NULL DEFAULT 'AED',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_balance_non_negative CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS transfers (
    id                    VARCHAR(64)    PRIMARY KEY,
    source_wallet_id      VARCHAR(64)    NOT NULL REFERENCES wallets(id),
    destination_wallet_id VARCHAR(64)    NOT NULL REFERENCES wallets(id),
    amount                NUMERIC(19, 4) NOT NULL,
    currency              VARCHAR(10)    NOT NULL,
    reference             VARCHAR(255),
    status                VARCHAR(32)    NOT NULL DEFAULT 'PENDING',
    idempotency_key       VARCHAR(255)   UNIQUE,
    failure_reason        TEXT,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_amount_positive   CHECK (amount > 0),
    CONSTRAINT chk_different_wallets CHECK (source_wallet_id <> destination_wallet_id),
    CONSTRAINT chk_valid_status      CHECK (status IN ('PENDING','COMPLETED','FAILED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key           VARCHAR(255)   PRIMARY KEY,
    request_hash  VARCHAR(64)    NOT NULL,
    response_body TEXT,
    status_code   INT,
    status        VARCHAR(32)    NOT NULL DEFAULT 'PROCESSING',
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_events (
    id          BIGSERIAL   PRIMARY KEY,
    transfer_id VARCHAR(64) NOT NULL REFERENCES transfers(id),
    event_type  VARCHAR(64) NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id          BIGSERIAL   PRIMARY KEY,
    event_type  VARCHAR(64) NOT NULL,
    payload     JSONB       NOT NULL,
    transfer_id VARCHAR(64),
    published   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_idem_key ON transfers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transfer_events_tid ON transfer_events(transfer_id);
CREATE INDEX IF NOT EXISTS idx_outbox_tid ON outbox_events(transfer_id);

