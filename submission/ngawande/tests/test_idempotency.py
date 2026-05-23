"""Tests for duplicate/retry handling (idempotency).

Checks that:
- Sending the same request twice (same key + same data) doesn't charge twice
- Sending a different request with the same key is rejected (409)
- Without a key, each request creates a separate transfer
"""

import pytest

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.builders import unique_idempotency_key
from tests.helpers.db_helpers import (
    get_audit_event_count,
    get_outbox_event_count,
    get_transfer_count,
    get_wallet_balance,
)


# -- Same key + same payload (retry) ----------------------------------------


def test_same_key_same_payload_returns_original(client):
    """API layer: duplicate with same key+payload returns 200 and same ID."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    resp1 = api.create_transfer(amount=1000, idempotency_key=key)
    resp2 = api.create_transfer(amount=1000, idempotency_key=key)

    assert resp1.status_code == 201
    assert resp2.status_code == 200
    assert resp1.get_json()["id"] == resp2.get_json()["id"]


def test_same_key_same_payload_no_double_debit(client, app):
    """DB invariant: duplicate does not debit the source wallet twice."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)

    assert get_wallet_balance(app.db, "wallet_001") == 9_000  # debited once


def test_same_key_same_payload_single_transfer_row(client, app):
    """DB invariant: duplicate creates exactly one transfer row."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)

    assert get_transfer_count(app.db) == 1


@pytest.mark.reliability
def test_same_key_same_payload_single_audit_event(client, app):
    """Cross-component: duplicate does not create a second audit row."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)

    assert get_audit_event_count(app.db) == 1


@pytest.mark.reliability
def test_same_key_same_payload_single_outbox_event(client, app):
    """Cross-component: duplicate does not create a second outbox row."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)

    assert get_outbox_event_count(app.db) == 1


# -- Same key + different payload (conflict) --------------------------------


def test_same_key_different_payload_rejected(client):
    """API layer: same key with different amount returns 409."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    resp1 = api.create_transfer(amount=1000, idempotency_key=key)
    resp2 = api.create_transfer(amount=2000, idempotency_key=key)

    assert resp1.status_code == 201
    assert resp2.status_code == 409
    assert "conflict" in resp2.get_json()["error"].lower()


def test_same_key_different_payload_no_second_transfer(client, app):
    """DB invariant: conflicting duplicate creates no second row and no second debit."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=2000, idempotency_key=key)

    assert get_transfer_count(app.db) == 1
    assert get_wallet_balance(app.db, "wallet_001") == 9_000  # only first debit


# -- No idempotency key -----------------------------------------------------


def test_no_idempotency_key_creates_independent_transfers(client, app):
    """Without an idempotency key, each request creates a separate transfer."""
    api = TransferAPIClient(client)

    resp1 = api.create_transfer(amount=100)
    resp2 = api.create_transfer(amount=100)

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.get_json()["id"] != resp2.get_json()["id"]
    assert get_transfer_count(app.db) == 2
    assert get_wallet_balance(app.db, "wallet_001") == 9_800  # debited twice

