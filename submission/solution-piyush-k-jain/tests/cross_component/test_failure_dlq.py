"""Failure-path persistence — the DLQ-equivalent in this fixture.

In production this would be a real DLQ topic or error table. Here, when the
state machine transitions to `failed`, the system records the failure in two
durable places:
    1. the `transfers` row itself (status='failed')
    2. an audit row `transfer_failed` in `transfer_events`

These tests assert that:
    - the failure is durably persisted (you could query for failed transfers
      after a restart)
    - no business side effects fired (no outbox, no notification, no money moved)
    - the replay of a failed transfer returns the original failure, not a retry
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import (
    assert_audit_event_types,
    assert_no_balance_movement,
    assert_no_outbox_emission,
    assert_not_notified,
)


def test_failed_transfer_row_has_failed_status(client, db):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert db.transfer(transfer_id)["status"] == "failed"


def test_failed_transfer_audit_trail_complete(client, db):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert_audit_event_types(db, transfer_id, ["transfer_pending", "transfer_failed"])


def test_failed_transfer_publishes_no_business_event(client, db, publisher):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert_no_outbox_emission(db, publisher, transfer_id)


def test_failed_transfer_does_not_notify(client, notifier):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert_not_notified(notifier, transfer_id)


def test_failed_transfer_preserves_balances(client, db, seed_balances):
    client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    assert_no_balance_movement(db, seed_balances)


def test_failed_transfers_queryable_after_the_fact(client, db):
    """An operator should be able to ask 'show me all failed transfers' and
    get a useful list. This is the DLQ-equivalent.
    """
    client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    client.create_transfer(TransferRequestBuilder().build())  # one success

    assert db.transfers_by_status("failed") == 2
    assert db.transfers_by_status("completed") == 1
    assert db.transfers_by_status("pending") == 0


def test_replay_after_failure_returns_failure_not_retry(client, db):
    """An automatic retry that converts failure to success silently would be
    a correctness bug. Replay returns the original failure deterministically.
    """
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    client.create_transfer(payload, idempotency_key=key, force_fail=True)
    replay = client.create_transfer(payload, idempotency_key=key)

    assert replay.status_code == 200
    assert replay.get_json()["status"] == "failed"
    assert db.transfer_count() == 1
    assert db.transfers_by_status("completed") == 0
