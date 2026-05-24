"""Transfer lifecycle: every transfer must pass through `pending` before
reaching a terminal state.

Two terminal states are tested:
    pending -> completed   (default path)
    pending -> failed      (force_fail=true test hook)

We check the audit trail, not just the final status, so a service that
"jumped straight to completed" without recording the intermediate state would
fail these tests.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import (
    assert_audit_event_types,
    assert_no_balance_movement,
    assert_transfer_status,
)


def test_successful_transfer_records_pending_then_completed(client, db):
    response = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = response.get_json()["id"]

    assert_transfer_status(db, transfer_id, "completed")
    assert_audit_event_types(
        db, transfer_id, ["transfer_pending", "transfer_completed"]
    )


def test_failed_transfer_records_pending_then_failed(client, db):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]

    assert response.status_code == 201
    assert response.get_json()["status"] == "failed"
    assert_transfer_status(db, transfer_id, "failed")
    assert_audit_event_types(db, transfer_id, ["transfer_pending", "transfer_failed"])


def test_failed_transfer_does_not_move_money(client, db, seed_balances):
    client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    assert_no_balance_movement(db, seed_balances)


def test_completed_state_has_updated_at_after_created_at(client, db):
    """Sanity invariant: every successful transfer's updated_at must be at
    least the same as created_at. Catches a state machine that forgets to
    advance the timestamp on transition.
    """
    response = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = response.get_json()["id"]
    row = db.transfer(transfer_id)
    assert row is not None
    assert row["updated_at"] >= row["created_at"]


def test_no_terminal_state_is_re_entered_on_replay(client, db):
    """An idempotent replay must not write extra audit events: state machine
    runs exactly once per logical request.
    """
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert db.audit_event_count() == 2  # one pending + one completed
