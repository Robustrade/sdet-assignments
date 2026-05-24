"""`transfer_events` (audit log) persistence.

Every successful transfer must produce exactly one `transfer_pending` + one
`transfer_completed` audit row (in order). Failures produce `transfer_pending`
+ `transfer_failed`. Rejected (validation/insufficient) requests produce none.

Audit trail is what an investigator would read after the fact; we want it to
be a complete and tamper-evident record of every state change.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import assert_audit_event_types


def test_successful_transfer_writes_pending_then_completed_audit(client, db):
    response = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = response.get_json()["id"]
    assert_audit_event_types(
        db, transfer_id, ["transfer_pending", "transfer_completed"]
    )


def test_failed_transfer_writes_pending_then_failed_audit(client, db):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert_audit_event_types(db, transfer_id, ["transfer_pending", "transfer_failed"])


def test_audit_payload_contains_amount_and_currency(client, db):
    response = client.create_transfer(
        TransferRequestBuilder().with_amount(1234).build()
    )
    transfer_id = response.get_json()["id"]
    events = db.audit_events_for(transfer_id)
    for ev in events:
        assert ev["payload"] is not None
        # payload is JSON; we want to ensure the amount we sent shows up
        assert "1234" in ev["payload"]
        assert "AED" in ev["payload"]


def test_replay_does_not_double_write_audit_events(client, db):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    # Only the first call ran the state machine; replays short-circuit.
    assert db.audit_event_count() == 2


def test_rejected_request_writes_no_audit(client, db):
    client.create_transfer(TransferRequestBuilder().with_amount(0).build())
    assert db.audit_event_count() == 0


def test_audit_events_have_monotonic_timestamps(client, db):
    response = client.create_transfer(TransferRequestBuilder().build())
    events = db.audit_events_for(response.get_json()["id"])
    timestamps = [e["created_at"] for e in events]
    assert timestamps == sorted(
        timestamps
    ), f"audit timestamps not monotonic: {timestamps}"
