-- Wallet Transfer Service schema.
-- Money is stored as integer minor units (BIGINT); floating point is never
-- used for balances. DB-level CHECK constraints act as defense in depth:
-- the service must reject bad states first, but the schema refuses them too.

CREATE TABLE wallets (
    wallet_id   TEXT PRIMARY KEY,
    currency    CHAR(3) NOT NULL,
    balance     BIGINT NOT NULL CHECK (balance >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transfers (
    transfer_id            UUID PRIMARY KEY,
    source_wallet_id       TEXT NOT NULL REFERENCES wallets (wallet_id),
    destination_wallet_id  TEXT NOT NULL REFERENCES wallets (wallet_id),
    amount                 BIGINT NOT NULL CHECK (amount > 0),
    currency               CHAR(3) NOT NULL,
    reference              TEXT,
    status                 TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
    failure_reason         TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at           TIMESTAMPTZ,
    CHECK (source_wallet_id <> destination_wallet_id)
);

-- Reservation-based idempotency store. A row is inserted (reserved) BEFORE
-- processing begins; the PRIMARY KEY makes concurrent duplicates lose the
-- insert race deterministically. request_hash detects same-key/different-payload
-- misuse. transfer_id + response_status are enough to reconstruct a replay
-- response by joining back to the transfers table -- no need to duplicate the
-- response body here.
CREATE TABLE idempotency_keys (
    idempotency_key  TEXT PRIMARY KEY,
    request_hash     TEXT NOT NULL,
    state            TEXT NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
    transfer_id      UUID REFERENCES transfers (transfer_id),
    response_status  INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail of the transfer lifecycle.
CREATE TABLE transfer_events (
    event_id    BIGSERIAL PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES transfers (transfer_id),
    event_type  TEXT NOT NULL
        CHECK (event_type IN ('TRANSFER_REQUESTED', 'TRANSFER_COMPLETED', 'TRANSFER_FAILED')),
    details     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox: written in the SAME transaction as the transfer, so
-- an event exists if and only if the transfer committed. A relay/publisher
-- is intentionally out of scope (see STRATEGY.md).
CREATE TABLE outbox_events (
    outbox_id      BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    payload        TEXT NOT NULL,
    published      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_source ON transfers (source_wallet_id);
CREATE INDEX idx_transfers_destination ON transfers (destination_wallet_id);
CREATE INDEX idx_transfer_events_transfer ON transfer_events (transfer_id);
CREATE INDEX idx_outbox_unpublished ON outbox_events (published) WHERE NOT published;
