"""Outbox + publish: exactly-once event emission per successful transfer.

The outbox table is the durable record; the stub publisher is the in-process
stand-in for a real broker. Both must agree that exactly one event was emitted
for each successful transfer, and the outbox row must be marked `published=1`
only after the publisher recorded the call.
"""

import json

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import (
    assert_no_outbox_emission,
    assert_outbox_emitted_once,
)


def test_one_outbox_row_per_successful_transfer(client, db):
    client.create_transfer(TransferRequestBuilder().build())
    client.create_transfer(TransferRequestBuilder().build())
    client.create_transfer(TransferRequestBuilder().build())
    assert db.outbox_count() == 3


def test_outbox_row_marked_published_after_publish(client, db, publisher):
    response = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = response.get_json()["id"]
    assert_outbox_emitted_once(db, publisher, transfer_id)


def test_outbox_payload_contains_transfer_details(client, db):
    response = client.create_transfer(
        TransferRequestBuilder().with_amount(1234).build()
    )
    transfer_id = response.get_json()["id"]
    row = db.outbox_rows_for(transfer_id)[0]
    payload = json.loads(row["payload"])
    assert payload["transfer_id"] == transfer_id
    assert payload["amount"] == 1234
    assert payload["currency"] == "AED"


def test_publisher_received_one_event_per_successful_transfer(client, publisher):
    a = client.create_transfer(TransferRequestBuilder().build())
    b = client.create_transfer(TransferRequestBuilder().build())
    assert publisher.count() == 2
    assert len(publisher.events_for(a.get_json()["id"])) == 1
    assert len(publisher.events_for(b.get_json()["id"])) == 1


def test_idempotent_replay_does_not_re_emit(client, db, publisher):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    first = client.create_transfer(payload, idempotency_key=key)
    transfer_id = first.get_json()["id"]
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert_outbox_emitted_once(db, publisher, transfer_id)
    assert db.outbox_count() == 1
    assert publisher.count() == 1


def test_failed_transfer_does_not_emit_outbox(client, db, publisher):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    assert_no_outbox_emission(db, publisher, transfer_id)


def test_rejected_transfer_does_not_emit_outbox(client, db, publisher):
    client.create_transfer(TransferRequestBuilder().with_amount(0).build())
    assert db.outbox_count() == 0
    assert publisher.count() == 0
