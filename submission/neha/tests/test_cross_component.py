"""Cross-component validation: audit trail and outbox exactly-once semantics."""

from tests.helpers.builders import new_idempotency_key, transfer_payload
from tests.helpers.db_assertions import audit_count, outbox_count


def test_successful_transfer_writes_one_outbox_event(api, db):
    resp = api.create_transfer(transfer_payload(amount=400))
    transfer_id = resp.get_json()["id"]

    row = db.execute(
        "SELECT * FROM outbox_events WHERE transfer_id = ?",
        (transfer_id,),
    ).fetchone()
    assert row is not None
    assert row["event_type"] == "wallet.transfer.completed"
    assert row["status"] == "pending"
    assert outbox_count(db, transfer_id) == 1


def test_successful_transfer_writes_one_audit_event(api, db):
    resp = api.create_transfer(transfer_payload(amount=400))
    transfer_id = resp.get_json()["id"]
    assert audit_count(db, transfer_id) == 1


def test_duplicate_replay_does_not_emit_extra_outbox_or_audit(api, db):
    key = new_idempotency_key("outbox")
    payload = transfer_payload(amount=400)

    first = api.create_transfer(payload, idempotency_key=key)
    api.create_transfer(payload, idempotency_key=key)
    transfer_id = first.get_json()["id"]

    assert audit_count(db, transfer_id) == 1
    assert outbox_count(db, transfer_id) == 1
    assert outbox_count(db) == 1
    assert audit_count(db) == 1


def test_rejected_transfer_writes_no_outbox_or_audit(api, db):
    api.create_transfer(transfer_payload(amount=99999))
    assert audit_count(db) == 0
    assert outbox_count(db) == 0
