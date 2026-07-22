"""Happy path: API success plus API↔DB and side-effect consistency."""

from tests.helpers.builders import new_idempotency_key, transfer_payload
from tests.helpers.db_assertions import (
    assert_balances,
    assert_successful_transfer_persistence,
    wallet_balance,
)


def test_transfer_returns_201_and_completed_status(api):
    resp = api.create_transfer(
        transfer_payload(amount=2500),
        idempotency_key=new_idempotency_key("hp"),
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "completed"
    assert body["amount"] == 2500
    assert body["source_wallet_id"] == "wallet_001"
    assert body["destination_wallet_id"] == "wallet_002"


def test_source_and_destination_balances_move_exactly_once(api, db):
    before_src = wallet_balance(db, "wallet_001")
    before_dst = wallet_balance(db, "wallet_002")

    resp = api.create_transfer(transfer_payload(amount=3000))
    assert resp.status_code == 201

    assert_balances(
        db,
        source="wallet_001",
        destination="wallet_002",
        source_bal=before_src - 3000,
        dest_bal=before_dst + 3000,
    )


def test_transfer_record_and_side_effects_persisted(api, db):
    resp = api.create_transfer(transfer_payload(amount=500, reference="ref-1"))
    transfer_id = resp.get_json()["id"]
    assert_successful_transfer_persistence(db, transfer_id, amount=500)


def test_get_transfer_matches_persisted_row(api, db):
    created = api.create_transfer(transfer_payload(amount=750)).get_json()
    get_resp = api.get_transfer(created["id"])
    assert get_resp.status_code == 200

    api_body = get_resp.get_json()
    db_row = db.execute(
        "SELECT * FROM transfers WHERE id = ?",
        (created["id"],),
    ).fetchone()
    assert api_body["status"] == db_row["status"] == "completed"
    assert api_body["amount"] == db_row["amount"] == 750


def test_get_wallet_reflects_updated_balance(api):
    api.create_transfer(transfer_payload(amount=2000))
    resp = api.get_wallet("wallet_001")
    assert resp.status_code == 200
    assert resp.get_json()["balance"] == 8000
