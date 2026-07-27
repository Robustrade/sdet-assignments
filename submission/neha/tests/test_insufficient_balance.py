"""Insufficient balance: reject without mutating balances or side-effect tables."""

from tests.helpers.builders import transfer_payload
from tests.helpers.db_assertions import (
    assert_balances,
    assert_no_side_effects,
    wallet_balance,
)


def test_insufficient_balance_returns_422(api):
    resp = api.create_transfer(transfer_payload(amount=99999))
    assert resp.status_code == 422
    assert resp.get_json()["error"] == "insufficient balance"


def test_insufficient_balance_leaves_state_unchanged(api, db):
    api.create_transfer(transfer_payload(amount=99999))
    assert_balances(
        db,
        source="wallet_001",
        destination="wallet_002",
        source_bal=10000,
        dest_bal=5000,
    )
    assert_no_side_effects(db)


def test_zero_balance_wallet_rejected(api, db):
    resp = api.create_transfer(
        transfer_payload(source="wallet_003", destination="wallet_001", amount=1)
    )
    assert resp.status_code == 422
    assert wallet_balance(db, "wallet_003") == 0


def test_exact_balance_transfer_succeeds(api, db):
    resp = api.create_transfer(transfer_payload(amount=10000))
    assert resp.status_code == 201
    assert wallet_balance(db, "wallet_001") == 0
    assert wallet_balance(db, "wallet_002") == 15000
