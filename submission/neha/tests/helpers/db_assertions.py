"""Reusable database assertions for transfer invariants."""

from __future__ import annotations


def wallet_balance(db, wallet_id: str) -> int:
    row = db.execute(
        "SELECT balance FROM wallets WHERE id = ?",
        (wallet_id,),
    ).fetchone()
    assert row is not None, f"wallet {wallet_id} missing"
    return row["balance"]


def transfer_count(db) -> int:
    return db.execute("SELECT COUNT(*) AS c FROM transfers").fetchone()["c"]


def audit_count(db, transfer_id: str | None = None) -> int:
    if transfer_id is None:
        return db.execute("SELECT COUNT(*) AS c FROM audit_events").fetchone()["c"]
    return db.execute(
        "SELECT COUNT(*) AS c FROM audit_events WHERE transfer_id = ?",
        (transfer_id,),
    ).fetchone()["c"]


def outbox_count(db, transfer_id: str | None = None) -> int:
    if transfer_id is None:
        return db.execute("SELECT COUNT(*) AS c FROM outbox_events").fetchone()["c"]
    return db.execute(
        "SELECT COUNT(*) AS c FROM outbox_events WHERE transfer_id = ?",
        (transfer_id,),
    ).fetchone()["c"]


def idempotency_row(db, key: str):
    return db.execute(
        "SELECT * FROM idempotency_keys WHERE key = ?",
        (key,),
    ).fetchone()


def assert_balances(
    db, *, source: str, destination: str, source_bal: int, dest_bal: int
):
    assert wallet_balance(db, source) == source_bal
    assert wallet_balance(db, destination) == dest_bal


def assert_no_side_effects(db):
    assert transfer_count(db) == 0
    assert audit_count(db) == 0
    assert outbox_count(db) == 0
    count = db.execute("SELECT COUNT(*) AS c FROM idempotency_keys").fetchone()["c"]
    assert count == 0


def assert_successful_transfer_persistence(db, transfer_id: str, *, amount: int):
    transfer = db.execute(
        "SELECT * FROM transfers WHERE id = ?",
        (transfer_id,),
    ).fetchone()
    assert transfer is not None
    assert transfer["status"] == "completed"
    assert transfer["amount"] == amount

    assert audit_count(db, transfer_id) == 1
    audit = db.execute(
        "SELECT * FROM audit_events WHERE transfer_id = ?",
        (transfer_id,),
    ).fetchone()
    assert audit["event_type"] == "transfer_completed"

    assert outbox_count(db, transfer_id) == 1
    outbox = db.execute(
        "SELECT * FROM outbox_events WHERE transfer_id = ?",
        (transfer_id,),
    ).fetchone()
    assert outbox["event_type"] == "wallet.transfer.completed"
    assert outbox["status"] == "pending"
