"""Concurrency and reliability: threaded race condition and retry-safety tests.

All tests in this module carry the @pytest.mark.reliability marker so they
can be run independently via: pytest -m reliability
"""

import threading

import pytest

from tests.helpers.db_helpers import (
    get_audit_event_count,
    get_outbox_event_count,
    get_transfer_count,
    get_wallet_balance,
)


@pytest.mark.reliability
def test_concurrent_transfers_balance_never_goes_negative(app):
    """Five concurrent transfers of 3000 from a 10000 wallet — at most 3 succeed.

    Invariants:
    - final balance >= 0
    - final balance = 10000 - (successes * 3000)
    - transfer rows == successes
    """
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
    failures = statuses.count(422)

    assert successes + failures == 5, f"Unexpected status codes: {statuses}"
    assert successes <= 3

    balance = get_wallet_balance(app.db, "wallet_001")
    assert balance >= 0
    assert balance == 10_000 - successes * 3000

    # Transfer row count must match successes
    assert get_transfer_count(app.db) == successes


@pytest.mark.reliability
def test_concurrent_same_idempotency_key_produces_one_transfer(app):
    """Ten concurrent requests sharing one idempotency key must debit exactly once.

    Invariants:
    - exactly 1 transfer row
    - balance debited once (9000)
    - exactly 1 audit event
    - exactly 1 outbox event
    - all responses are 200 or 201
    """
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

    # All responses must be success (201 for first, 200 for replays)
    assert all(s in (200, 201) for s in statuses), f"Unexpected statuses: {statuses}"
    assert statuses.count(201) == 1  # exactly one creation

    # DB invariants
    assert get_transfer_count(app.db) == 1
    assert get_wallet_balance(app.db, "wallet_001") == 9_000  # debited once
    assert get_audit_event_count(app.db) == 1
    assert get_outbox_event_count(app.db) == 1


@pytest.mark.reliability
def test_retry_storm_does_not_double_debit(client, app):
    """Five sequential retries of the same idempotent request settle to a single debit.

    Simulates a client retrying after assumed response loss.
    """
    payload = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 2500,
        "currency": "AED",
    }
    headers = {"Idempotency-Key": "retry-safe-001"}

    responses = []
    for _ in range(5):
        resp = client.post("/transfers", json=payload, headers=headers)
        responses.append(resp.status_code)

    # First is 201, rest are 200
    assert responses[0] == 201
    assert all(s == 200 for s in responses[1:])

    assert get_transfer_count(app.db) == 1
    assert get_wallet_balance(app.db, "wallet_001") == 7_500  # 10000 - 2500
    assert get_audit_event_count(app.db) == 1
    assert get_outbox_event_count(app.db) == 1


@pytest.mark.reliability
def test_concurrent_competing_transfers_total_balance_conserved(app):
    """Multiple concurrent transfers must conserve total system balance.

    Total across all wallets must remain constant regardless of which
    transfers succeed or fail.
    """
    from tests.helpers.db_helpers import get_total_wallet_balance

    total_before = get_total_wallet_balance(app.db)
    lock = threading.Lock()
    statuses: list[int] = []

    def do_transfer(amount: int) -> None:
        with app.test_client() as c:
            resp = c.post(
                "/transfers",
                json={
                    "source_wallet_id": "wallet_001",
                    "destination_wallet_id": "wallet_002",
                    "amount": amount,
                    "currency": "AED",
                },
            )
            with lock:
                statuses.append(resp.status_code)

    amounts = [1000, 2000, 3000, 4000, 5000]
    threads = [threading.Thread(target=do_transfer, args=(a,)) for a in amounts]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    total_after = get_total_wallet_balance(app.db)
    assert total_before == total_after, (
        f"Balance conservation violated: {total_before} → {total_after}"
    )

