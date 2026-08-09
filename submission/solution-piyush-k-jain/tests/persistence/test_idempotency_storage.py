"""Dedicated `idempotency_keys` table.

Asserts:
    - one row per key, linked to the transfer it produced
    - the row stores a hash of the canonical payload (so conflict detection is
      hash-based, not full-body comparison)
    - replay does NOT create a second row
    - no key on the request -> no row at all
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key


def test_idempotency_row_created_on_first_request(client, db):
    key = new_idempotency_key()
    response = client.create_transfer(
        TransferRequestBuilder().build(), idempotency_key=key
    )

    row = db.idempotency_row(key)
    assert row is not None
    assert row["transfer_id"] == response.get_json()["id"]
    assert isinstance(row["payload_hash"], str) and len(row["payload_hash"]) == 64
    assert row["created_at"] is not None


def test_replay_does_not_create_a_second_idempotency_row(client, db):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()

    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert db.idempotency_count() == 1


def test_no_idempotency_row_when_header_absent(client, db):
    client.create_transfer(TransferRequestBuilder().build())
    assert db.idempotency_count() == 0


def test_conflict_does_not_create_idempotency_row(client, db):
    key = new_idempotency_key()
    client.create_transfer(
        TransferRequestBuilder().with_amount(1000).build(), idempotency_key=key
    )
    client.create_transfer(
        TransferRequestBuilder().with_amount(2000).build(), idempotency_key=key
    )

    assert db.idempotency_count() == 1  # only the original


def test_idempotency_key_persists_for_failed_transfer(client, db):
    """A failed transfer still consumes its idempotency key so replays are
    deterministic. Catches accidental "retry on failure" leakage.
    """
    key = new_idempotency_key()
    client.create_transfer(
        TransferRequestBuilder().build(), idempotency_key=key, force_fail=True
    )
    row = db.idempotency_row(key)
    assert row is not None
