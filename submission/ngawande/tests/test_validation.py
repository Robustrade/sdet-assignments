"""Validation failures: bad input must be rejected with no DB side-effects.

Each test verifies both the API rejection (422) and the absence of any
persistence side-effects (no transfer rows, no balance changes, no events).
"""

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.db_helpers import (
    get_audit_event_count,
    get_outbox_event_count,
    get_transfer_count,
    get_wallet_balance,
)


# -- Missing required fields ------------------------------------------------


def test_missing_source_wallet(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer_raw(
        {"destination_wallet_id": "wallet_002", "amount": 100, "currency": "AED"}
    )
    assert resp.status_code == 422
    assert "source_wallet_id" in resp.get_json().get("fields", [])


def test_missing_destination_wallet(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer_raw(
        {"source_wallet_id": "wallet_001", "amount": 100, "currency": "AED"}
    )
    assert resp.status_code == 422
    assert "destination_wallet_id" in resp.get_json().get("fields", [])


def test_missing_amount(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer_raw(
        {
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "currency": "AED",
        }
    )
    assert resp.status_code == 422


def test_missing_currency(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer_raw(
        {
            "source_wallet_id": "wallet_001",
            "destination_wallet_id": "wallet_002",
            "amount": 100,
        }
    )
    assert resp.status_code == 422


# -- Invalid field values ---------------------------------------------------


def test_invalid_currency(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(currency="XYZ")
    assert resp.status_code == 422
    assert "invalid currency" in resp.get_json()["error"]


def test_negative_amount(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=-100)
    assert resp.status_code == 422
    assert "positive" in resp.get_json()["error"]


def test_zero_amount(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=0)
    assert resp.status_code == 422


def test_same_source_and_destination(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(source="wallet_001", destination="wallet_001")
    assert resp.status_code == 422
    assert "differ" in resp.get_json()["error"]


def test_nonexistent_source_wallet(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(source="wallet_999")
    assert resp.status_code == 422
    assert "not found" in resp.get_json()["error"]


def test_nonexistent_destination_wallet(client):
    api = TransferAPIClient(client)
    resp = api.create_transfer(destination="wallet_999")
    assert resp.status_code == 422
    assert "not found" in resp.get_json()["error"]


# -- DB side-effect absence -------------------------------------------------


def test_invalid_input_leaves_no_transfer_record(client, app):
    """DB layer: rejected request must not create any transfer row."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=-999)
    assert get_transfer_count(app.db) == 0


def test_invalid_input_leaves_balances_unchanged(client, app):
    """DB layer: rejected request must not mutate any wallet balance."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=0)
    assert get_wallet_balance(app.db, "wallet_001") == 10_000
    assert get_wallet_balance(app.db, "wallet_002") == 5_000


def test_invalid_input_creates_no_audit_event(client, app):
    """Cross-component: rejected request must not write audit rows."""
    api = TransferAPIClient(client)
    api.create_transfer(currency="INVALID")
    assert get_audit_event_count(app.db) == 0


def test_invalid_input_creates_no_outbox_event(client, app):
    """Cross-component: rejected request must not write outbox rows."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=-1)
    assert get_outbox_event_count(app.db) == 0


def test_currency_mismatch_rejected(client):
    """Wallet currency must match request currency."""
    api = TransferAPIClient(client)
    # wallet_001 is AED, sending USD should fail
    resp = api.create_transfer(source="wallet_001", currency="USD")
    assert resp.status_code == 422

