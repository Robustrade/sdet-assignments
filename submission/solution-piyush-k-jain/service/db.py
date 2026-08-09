"""Database schema for the wallet transfer service fixture.

Five tables map 1:1 to the assignment's required persistence artifacts:
    wallets             - account balances
    transfers           - transfer records with state (pending/completed/failed)
    idempotency_keys    - dedicated idempotency store (separate from transfers)
    transfer_events     - audit log of every state transition
    outbox_events       - outbox pattern for downstream event emission
"""

import sqlite3

DDL = """
CREATE TABLE IF NOT EXISTS wallets (
    id       TEXT    PRIMARY KEY,
    balance  INTEGER NOT NULL CHECK(balance >= 0),
    currency TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
    id                    TEXT    PRIMARY KEY,
    source_wallet_id      TEXT    NOT NULL,
    destination_wallet_id TEXT    NOT NULL,
    amount                INTEGER NOT NULL CHECK(amount > 0),
    currency              TEXT    NOT NULL,
    reference             TEXT,
    status                TEXT    NOT NULL
                                 CHECK(status IN ('pending', 'completed', 'failed')),
    created_at            TEXT    NOT NULL,
    updated_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key          TEXT PRIMARY KEY,
    transfer_id  TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);

CREATE TABLE IF NOT EXISTS transfer_events (
    id          TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id          TEXT    PRIMARY KEY,
    transfer_id TEXT    NOT NULL,
    event_type  TEXT    NOT NULL,
    payload     TEXT    NOT NULL,
    published   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);
"""

REQUIRED_TABLES: dict[str, set[str]] = {
    "wallets": {"id", "balance", "currency"},
    "transfers": {
        "id",
        "source_wallet_id",
        "destination_wallet_id",
        "amount",
        "currency",
        "reference",
        "status",
        "created_at",
        "updated_at",
    },
    "idempotency_keys": {"key", "transfer_id", "payload_hash", "created_at"},
    "transfer_events": {
        "id",
        "transfer_id",
        "event_type",
        "payload",
        "created_at",
    },
    "outbox_events": {
        "id",
        "transfer_id",
        "event_type",
        "payload",
        "published",
        "created_at",
    },
}


def init_schema(conn: sqlite3.Connection) -> None:
    """Idempotent schema creation."""
    conn.executescript(DDL)
    conn.commit()
