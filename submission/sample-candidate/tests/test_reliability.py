"""Reliability: concurrency and retry-safety invariants."""

import threading

import pytest


@pytest.mark.reliability
def test_concurrent_transfers_balance_never_goes_negative(app):
    """Concurrent transfers from one wallet must never produce a negative balance."""
    # wallet_001 has 10000; fire 5 concurrent transfers of 3000 each.
    # At most 3 can succeed (floor(10000/3000)=3). Balance must stay >= 0.
    statuses: list[int] = []
    lock = threading.Lock()

    def do_transfer(_: int) -> None:
        with app.test_client() as c:
            resp = c.post(
                "/transfers",
                json={
                    "source_wallet_id": "wallet_001",
                    "destination_wallet_id": "wallet_002",
                    "amount": 3000,
                    "currency": "AED",
                },
            )
            with lock:
                statuses.append(resp.status_code)

    threads = [threading.Thread(target=do_transfer, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    successes = statuses.count(201)
    assert successes <= 3

    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance >= 0
    assert balance == 10000 - successes * 3000


@pytest.mark.reliability
def test_concurrent_same_idempotency_key_produces_one_transfer(app):
    """Ten concurrent requests sharing one idempotency key must debit exactly once."""
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "concurrent-idem-001"}
    statuses: list[int] = []
    lock = threading.Lock()

    def do_transfer() -> None:
        with app.test_client() as c:
            resp = c.post("/transfers", json=payload, headers=headers)
            with lock:
                statuses.append(resp.status_code)

    threads = [threading.Thread(target=do_transfer) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Every response must be a recognised success code (201 first write, 200 replays)
    assert all(s in (200, 201) for s in statuses), f"Unexpected statuses: {statuses}"

    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 1

    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 9000  # debited exactly once


@pytest.mark.reliability
def test_retry_storm_does_not_double_debit(client, app):
    """Repeated retries of the same idempotent request must settle to a single debit."""
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 2500,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "retry-safe-001"}

    for _ in range(5):
        client.post("/transfers", json=payload, headers=headers)

    count = app.db.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    assert count == 1

    balance = app.db.execute(
        "SELECT balance FROM wallets WHERE id = ?", ("wallet_001",)
    ).fetchone()["balance"]
    assert balance == 7500  # 10000 - 2500, debited exactly once
