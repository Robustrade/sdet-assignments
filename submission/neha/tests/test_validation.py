"""Validation failures: reject bad input without any persistence side effects."""

from tests.helpers.builders import transfer_payload
from tests.helpers.db_assertions import assert_balances, assert_no_side_effects


def test_missing_required_fields(api):
    cases = [
        {"destination_wallet_id": "wallet_002", "amount": 100, "currency": "AED"},
        {"source_wallet_id": "wallet_001", "amount": 100, "currency": "AED"},
        {
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "currency": "AED",
        },
        {
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 100,
        },
    ]
    for payload in cases:
        resp = api.create_transfer(payload)
        assert resp.status_code == 422


def test_invalid_currency(api, db):
    resp = api.create_transfer(transfer_payload(currency="XYZ"))
    assert resp.status_code == 422
    assert_no_side_effects(db)


def test_negative_and_zero_amount(api, db):
    for amount in (-100, 0):
        resp = api.create_transfer(transfer_payload(amount=amount))
        assert resp.status_code == 422
    assert_no_side_effects(db)
    assert_balances(
        db,
        source="wallet_001",
        destination="wallet_002",
        source_bal=10000,
        dest_bal=5000,
    )


def test_same_source_and_destination(api, db):
    resp = api.create_transfer(
        transfer_payload(source="wallet_001", destination="wallet_001")
    )
    assert resp.status_code == 422
    assert_no_side_effects(db)


def test_unknown_wallet_rejected(api, db):
    resp = api.create_transfer(transfer_payload(source="missing_wallet"))
    assert resp.status_code == 422
    assert_no_side_effects(db)
