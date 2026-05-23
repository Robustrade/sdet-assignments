"""Database query helpers — direct DB assertions separated from test logic."""

from __future__ import annotations

import json
import sqlite3


def get_wallet_balance(db: sqlite3.Connection, wallet_id: str) -> int:
    """Return the current balance of a wallet."""
    row = db.execute(
        "SELECT balance FROM wallets WHERE id = ?", (wallet_id,)
    ).fetchone()
    assert row is not None, f"Wallet {wallet_id} not found"
    return row["balance"]


def get_transfer_count(db: sqlite3.Connection) -> int:
    """Return total number of transfer rows."""
    return db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]


def get_transfer_by_id(db: sqlite3.Connection, transfer_id: str) -> dict | None:
    """Return a transfer row as a dict, or None."""
    row = db.execute(
        "SELECT * FROM transfers WHERE id = ?", (transfer_id,)
    ).fetchone()
    return dict(row) if row else None


def get_transfers_by_idempotency_key(
    db: sqlite3.Connection, key: str
) -> list[dict]:
    """Return all transfer rows matching an idempotency key."""
    rows = db.execute(
        "SELECT * FROM transfers WHERE idempotency_key = ?", (key,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_audit_event_count(db: sqlite3.Connection) -> int:
    """Return total number of audit_events rows."""
    return db.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]


def get_audit_events_for_transfer(
    db: sqlite3.Connection, transfer_id: str
) -> list[dict]:
    """Return all audit_events rows for a given transfer_id."""
    rows = db.execute(
        "SELECT * FROM audit_events WHERE transfer_id = ?", (transfer_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_outbox_event_count(db: sqlite3.Connection) -> int:
    """Return total number of outbox_events rows."""
    return db.execute("SELECT COUNT(*) FROM outbox_events").fetchone()[0]


def get_outbox_events_for_transfer(
    db: sqlite3.Connection, transfer_id: str
) -> list[dict]:
    """Return all outbox_events rows for a given transfer_id."""
    rows = db.execute(
        "SELECT * FROM outbox_events WHERE transfer_id = ?", (transfer_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_outbox_event_payload(db: sqlite3.Connection, transfer_id: str) -> dict | None:
    """Return parsed JSON payload from the outbox event for a transfer."""
    rows = get_outbox_events_for_transfer(db, transfer_id)
    if not rows:
        return None
    return json.loads(rows[0]["payload"])


def get_total_wallet_balance(db: sqlite3.Connection) -> int:
    """Return sum of all wallet balances (conservation check)."""
    row = db.execute("SELECT SUM(balance) FROM wallets").fetchone()
    return row[0] or 0

