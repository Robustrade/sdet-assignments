"""Tests for when wallet doesn't have enough money.

Checks that:
- Transfer is rejected (422)
- Both wallet balances stay exactly the same
- No records are created anywhere in the database
"""

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.db_helpers import (
    get_audit_event_count,
    get_outbox_event_count,
    get_transfer_count,
    get_wallet_balance,
)


def test_insufficient_balance_returns_422(client):
    """API layer: transfer exceeding balance is rejected."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=99_999)
    assert resp.status_code == 422
    assert "insufficient" in resp.get_json()["error"]


def test_insufficient_balance_source_unchanged(client, app):
    """DB layer: source wallet balance must not change on rejection."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)
    assert get_wallet_balance(app.db, "wallet_001") == 10_000


def test_insufficient_balance_destination_unchanged(client, app):
    """DB layer: destination wallet balance must not change on rejection."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)
    assert get_wallet_balance(app.db, "wallet_002") == 5_000


def test_insufficient_balance_no_transfer_record(client, app):
    """DB layer: no transfer row is created for a rejected transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)
    assert get_transfer_count(app.db) == 0


def test_insufficient_balance_no_audit_event(client, app):
    """Cross-component: no audit event is written for a rejected transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)
    assert get_audit_event_count(app.db) == 0


def test_insufficient_balance_no_outbox_event(client, app):
    """Cross-component: no outbox event is written for a rejected transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)
    assert get_outbox_event_count(app.db) == 0


def test_zero_balance_wallet_rejected(client):
    """API layer: transfer from a wallet with zero balance is rejected."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(source="wallet_003", destination="wallet_001", amount=1)
    assert resp.status_code == 422


def test_exact_balance_transfer_succeeds(client, app):
    """Edge case: transferring the entire balance should succeed."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=10_000)
    assert resp.status_code == 201
    assert get_wallet_balance(app.db, "wallet_001") == 0


def test_one_over_balance_rejected(client):
    """Edge case: transferring balance + 1 must fail."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=10_001)
    assert resp.status_code == 422

