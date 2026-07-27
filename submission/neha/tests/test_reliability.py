"""Reliability: concurrency and retry-safety invariants."""

from __future__ import annotations

import threading

import pytest

from tests.helpers.builders import new_idempotency_key, transfer_payload
from tests.helpers.db_assertions import (
    audit_count,
    outbox_count,
    transfer_count,
    wallet_balance,
)


@pytest.mark.reliability
def test_concurrent_transfers_never_overdraw(app):
    """Competing transfers against limited balance must keep balance >= 0."""
    # wallet_001 starts at 10000; five concurrent 3000 transfers → at most 3 succeed.
    statuses: list[int] = []
    lock = threading.Lock()

    def do_transfer() -> None:
        with app.test_client() as client:
            resp = client.post(
                "/transfers",
                json=transfer_payload(amount=3000, reference=None),
            )
            with lock:
                statuses.append(resp.status_code)

    threads = [threading.Thread(target=do_transfer) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    successes = statuses.count(201)
    assert successes <= 3
    balance = wallet_balance(app.db, "wallet_001")
    assert balance >= 0
    assert balance == 10000 - successes * 3000
    assert transfer_count(app.db) == successes


@pytest.mark.reliability
def test_concurrent_same_idempotency_key_produces_one_transfer(app):
    """In-flight duplicates with one key must debit and emit side effects once."""
    payload = transfer_payload(amount=1000, reference=None)
    key = new_idempotency_key("concurrent")
    statuses: list[int] = []
    lock = threading.Lock()

    def do_transfer() -> None:
        with app.test_client() as client:
            resp = client.post(
                "/transfers",
                json=payload,
                headers={"Idempotency-Key": key},
            )
            with lock:
                statuses.append(resp.status_code)

    threads = [threading.Thread(target=do_transfer) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert all(status in (200, 201) for status in statuses), statuses
    assert statuses.count(201) == 1
    assert transfer_count(app.db) == 1
    assert wallet_balance(app.db, "wallet_001") == 9000
    assert audit_count(app.db) == 1
    assert outbox_count(app.db) == 1


@pytest.mark.reliability
def test_retry_storm_does_not_double_debit(api, db):
    """Client retries after assumed response loss must remain exactly-once."""
    key = new_idempotency_key("retry")
    payload = transfer_payload(amount=2500)

    responses = [api.create_transfer(payload, idempotency_key=key) for _ in range(5)]

    assert responses[0].status_code == 201
    assert all(resp.status_code == 200 for resp in responses[1:])
    assert {resp.get_json()["id"] for resp in responses} == {
        responses[0].get_json()["id"]
    }
    assert transfer_count(db) == 1
    assert wallet_balance(db, "wallet_001") == 7500
    assert audit_count(db) == 1
    assert outbox_count(db) == 1
