"""Concurrent duplicate requests with the same idempotency key.

This is the worst case for a deduplication implementation: many in-flight
requests carrying the same key arrive at the same moment (think client
retry-storm crossed with a brief network blip). The system must produce
exactly one transfer, one debit, one credit, one outbox event, one
notification — regardless of who got there first.
"""

import threading

import pytest

from tests.support.api_client import TransferClient
from tests.support.builders import TransferRequestBuilder, new_idempotency_key


@pytest.mark.reliability
def test_ten_concurrent_same_key_requests_create_one_transfer(
    app, db, publisher, notifier
):
    key = new_idempotency_key("concurrent")
    payload = TransferRequestBuilder().with_amount(1000).build()

    statuses: list[int] = []
    bodies: list[dict] = []
    lock = threading.Lock()

    def attempt() -> None:
        with app.test_client() as http:
            client = TransferClient(http)
            response = client.create_transfer(payload, idempotency_key=key)
            with lock:
                statuses.append(response.status_code)
                bodies.append(response.get_json())

    threads = [threading.Thread(target=attempt) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Every response must be 200 (replay) or 201 (first writer); never a conflict.
    assert all(
        s in (200, 201) for s in statuses
    ), f"unexpected statuses under concurrent same-key load: {statuses}"
    assert (
        statuses.count(201) == 1
    ), f"expected exactly one first-writer 201, got {statuses.count(201)}"

    # All responses must reference the same transfer id
    ids = {b["id"] for b in bodies}
    assert len(ids) == 1, f"concurrent replays produced different ids: {ids}"

    # Persistence + side effects are exactly-once
    assert db.transfer_count() == 1
    assert db.idempotency_count() == 1
    assert db.outbox_count() == 1
    assert publisher.count() == 1
    assert notifier.count() == 1
    assert db.wallet_balance("wallet_001") == 9000  # debited once


@pytest.mark.reliability
def test_concurrent_same_key_different_payload_yields_one_success_others_conflict(
    app, db
):
    """Same key, different payloads concurrently: one wins, others get 409.
    This catches a TOCTOU bug where the deduplication check passes for two
    payloads racing to write the idempotency row.
    """
    key = new_idempotency_key("race")
    amounts = [1000, 2000, 3000, 4000, 5000]
    statuses: list[int] = []
    lock = threading.Lock()

    def attempt(amount: int) -> None:
        payload = TransferRequestBuilder().with_amount(amount).build()
        with app.test_client() as http:
            client = TransferClient(http)
            response = client.create_transfer(payload, idempotency_key=key)
            with lock:
                statuses.append(response.status_code)

    threads = [threading.Thread(target=attempt, args=(amt,)) for amt in amounts]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly one of the five attempts persisted; the others got rejected
    # (409 for "key already used with different payload", or 200 if the
    # payload happened to match — but with all-distinct amounts that shouldn't
    # happen).
    assert db.transfer_count() == 1
    assert db.idempotency_count() == 1
    assert statuses.count(201) == 1
    # The four losers must all be 409
    assert statuses.count(409) == 4
