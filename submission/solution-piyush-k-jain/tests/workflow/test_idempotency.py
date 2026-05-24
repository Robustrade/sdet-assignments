"""Idempotency semantics (MANDATORY area per assignment §D).

Covers:
    - same key + same payload  -> first creates (201), replays return (200) with
      byte-equal body and same id
    - same key + different payload -> 409, no second transfer, no side effects
    - no key -> every call is independent
    - replay through GET /transfers returns the same record
    - state machine + outbox + audit + balances are all "exactly-once"
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import (
    assert_exactly_one_credit,
    assert_exactly_one_debit,
    assert_response_equivalent,
    assert_single_transfer_row,
)


def test_first_call_returns_201_replay_returns_200(client):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()

    first = client.create_transfer(payload, idempotency_key=key)
    replay = client.create_transfer(payload, idempotency_key=key)

    assert first.status_code == 201
    assert replay.status_code == 200


def test_replay_returns_byte_equal_body(client):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()

    first = client.create_transfer(payload, idempotency_key=key)
    replay = client.create_transfer(payload, idempotency_key=key)

    assert_response_equivalent(first.get_json(), replay.get_json())


def test_same_key_same_payload_creates_one_transfer_row(client, db):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()

    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert_single_transfer_row(db)


def test_same_key_same_payload_debits_exactly_once(client, db):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().with_amount(2500).build()

    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert_exactly_one_debit(db, "wallet_001", before=10_000, by=2500)
    assert_exactly_one_credit(db, "wallet_002", before=5_000, by=2500)


def test_same_key_different_payload_returns_409(client):
    key = new_idempotency_key()
    client.create_transfer(
        TransferRequestBuilder().with_amount(1000).build(), idempotency_key=key
    )
    conflict = client.create_transfer(
        TransferRequestBuilder().with_amount(2000).build(), idempotency_key=key
    )

    assert conflict.status_code == 409
    assert "error" in conflict.get_json()


def test_same_key_different_payload_does_not_create_second_transfer(client, db):
    key = new_idempotency_key()
    client.create_transfer(
        TransferRequestBuilder().with_amount(1000).build(), idempotency_key=key
    )
    client.create_transfer(
        TransferRequestBuilder().with_amount(2000).build(), idempotency_key=key
    )
    client.create_transfer(
        TransferRequestBuilder().with_reference("different").build(),
        idempotency_key=key,
    )

    assert_single_transfer_row(db)
    assert_exactly_one_debit(db, "wallet_001", before=10_000, by=1000)


def test_no_idempotency_key_creates_independent_transfers(client, db):
    payload = TransferRequestBuilder().with_amount(100).build()
    first = client.create_transfer(payload)
    second = client.create_transfer(payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json()["id"] != second.get_json()["id"]
    assert db.transfer_count() == 2


def test_different_keys_same_payload_create_independent_transfers(client, db):
    payload = TransferRequestBuilder().with_amount(100).build()
    a = client.create_transfer(payload, idempotency_key=new_idempotency_key("a"))
    b = client.create_transfer(payload, idempotency_key=new_idempotency_key("b"))

    assert a.get_json()["id"] != b.get_json()["id"]
    assert db.transfer_count() == 2
    assert db.idempotency_count() == 2


def test_replay_after_get_returns_same_record(client):
    """Replay (POST) must reference the same transfer GET would return."""
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    first = client.create_transfer(payload, idempotency_key=key)

    transfer_id = first.get_json()["id"]
    via_get = client.get_transfer(transfer_id).get_json()
    via_replay = client.create_transfer(payload, idempotency_key=key).get_json()

    assert via_get["id"] == via_replay["id"]
    assert via_get["status"] == via_replay["status"]
    assert via_get["amount"] == via_replay["amount"]


def test_replay_after_failed_transfer_returns_failed_status(client, db):
    """If the original transfer ended in `failed`, the replay must surface that
    same failure (not retry the operation).
    """
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    client.create_transfer(payload, idempotency_key=key, force_fail=True)
    replay = client.create_transfer(payload, idempotency_key=key)

    assert replay.status_code == 200
    assert replay.get_json()["status"] == "failed"
    assert db.transfer_count() == 1
