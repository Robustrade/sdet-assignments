"""Retry safety: repeated retries with the same idempotency key must settle to
a single debit, single outbox emission, single notification.

Simulates a client that lost connectivity and retried five times after the
original request had already completed (a classic at-least-once-delivery
scenario from the client's perspective).
"""

import pytest

from tests.support.builders import TransferRequestBuilder, new_idempotency_key


@pytest.mark.reliability
def test_five_retries_settle_to_single_debit(client, db, publisher, notifier):
    key = new_idempotency_key("retry")
    payload = TransferRequestBuilder().with_amount(2500).build()

    for _ in range(5):
        client.create_transfer(payload, idempotency_key=key)

    assert db.transfer_count() == 1
    assert db.transfers_by_status("completed") == 1
    assert db.idempotency_count() == 1
    assert db.outbox_count() == 1
    assert publisher.count() == 1
    assert notifier.count() == 1
    assert db.wallet_balance("wallet_001") == 7500
    assert db.wallet_balance("wallet_002") == 7500


@pytest.mark.reliability
def test_retry_after_get_returns_same_response(client):
    """A client doing 'POST, GET, POST (retry)' must see the same record on
    both POSTs and the GET — a common retry-with-confirmation pattern.
    """
    key = new_idempotency_key("retry-get")
    payload = TransferRequestBuilder().build()

    first = client.create_transfer(payload, idempotency_key=key).get_json()
    via_get = client.get_transfer(first["id"]).get_json()
    retry = client.create_transfer(payload, idempotency_key=key).get_json()

    assert first["id"] == via_get["id"] == retry["id"]
    assert first["status"] == via_get["status"] == retry["status"]


@pytest.mark.reliability
def test_retry_storm_for_failed_transfer_stays_failed(client, db):
    """A client retrying after a failure must keep seeing 'failed' — the
    service must not "fix" the failure on retry.
    """
    key = new_idempotency_key("retry-failed")
    payload = TransferRequestBuilder().build()

    first = client.create_transfer(payload, idempotency_key=key, force_fail=True)
    for _ in range(4):
        replay = client.create_transfer(payload, idempotency_key=key)
        assert replay.get_json()["status"] == "failed"
        assert replay.get_json()["id"] == first.get_json()["id"]

    assert db.transfer_count() == 1
    assert db.transfers_by_status("failed") == 1
    assert db.transfers_by_status("completed") == 0
