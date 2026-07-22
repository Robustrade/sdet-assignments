"""Idempotency: duplicate submissions must not create duplicate side effects."""

from tests.helpers.builders import new_idempotency_key, transfer_payload
from tests.helpers.db_assertions import (
    assert_balances,
    audit_count,
    idempotency_row,
    outbox_count,
    transfer_count,
    wallet_balance,
)


def test_same_key_same_payload_returns_original(api):
    key = new_idempotency_key("idem")
    payload = transfer_payload(amount=1000)

    first = api.create_transfer(payload, idempotency_key=key)
    second = api.create_transfer(payload, idempotency_key=key)

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.get_json()["id"] == second.get_json()["id"]


def test_same_key_same_payload_no_double_debit_or_side_effects(api, db):
    key = new_idempotency_key("idem")
    payload = transfer_payload(amount=1000)

    first = api.create_transfer(payload, idempotency_key=key)
    api.create_transfer(payload, idempotency_key=key)
    transfer_id = first.get_json()["id"]

    assert wallet_balance(db, "wallet_001") == 9000
    assert transfer_count(db) == 1
    assert audit_count(db, transfer_id) == 1
    assert outbox_count(db, transfer_id) == 1
    assert idempotency_row(db, key)["transfer_id"] == transfer_id


def test_same_key_different_payload_rejected_without_extra_effects(api, db):
    key = new_idempotency_key("conflict")
    api.create_transfer(transfer_payload(amount=1000), idempotency_key=key)

    conflict = api.create_transfer(
        transfer_payload(amount=2000),
        idempotency_key=key,
    )
    assert conflict.status_code == 409
    assert transfer_count(db) == 1
    assert_balances(
        db,
        source="wallet_001",
        destination="wallet_002",
        source_bal=9000,
        dest_bal=6000,
    )


def test_missing_idempotency_key_creates_independent_transfers(api, db):
    payload = transfer_payload(amount=100)
    first = api.create_transfer(payload)
    second = api.create_transfer(payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json()["id"] != second.get_json()["id"]
    assert transfer_count(db) == 2
    assert wallet_balance(db, "wallet_001") == 9800
