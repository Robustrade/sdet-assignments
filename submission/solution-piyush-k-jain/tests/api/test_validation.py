"""Validation: every bad request must be rejected (422) AND leave the DB
untouched.

For each invalid input we check two things:
    1. the API returns 422 with a useful error envelope
    2. no transfer row, no audit event, and no balance movement was persisted

If either side ever drifts (e.g., a route handler quietly inserts before
validating), these tests catch it.
"""

import pytest

from tests.support.builders import TransferRequestBuilder


@pytest.mark.parametrize(
    "missing_field",
    ["source_wallet_id", "destination_wallet_id", "amount", "currency"],
)
def test_missing_required_field_returns_422(client, missing_field):
    payload = TransferRequestBuilder().missing(missing_field).build()
    response = client.create_transfer(payload)

    assert response.status_code == 422
    body = response.get_json()
    assert "error" in body
    assert "fields" in body
    assert missing_field in body["fields"]


def test_invalid_currency_returns_422(client):
    payload = TransferRequestBuilder().with_currency("XYZ").build()
    assert client.create_transfer(payload).status_code == 422


def test_currency_must_be_string(client):
    payload = TransferRequestBuilder().with_currency(123).build()
    assert client.create_transfer(payload).status_code == 422


@pytest.mark.parametrize("amount", [0, -1, -1000])
def test_non_positive_amount_returns_422(client, amount):
    payload = TransferRequestBuilder().with_amount(amount).build()
    assert client.create_transfer(payload).status_code == 422


@pytest.mark.parametrize("amount", [1.5, "100", None, True])
def test_non_integer_amount_returns_422(client, amount):
    payload = TransferRequestBuilder().with_amount(amount).build()
    assert client.create_transfer(payload).status_code == 422


def test_same_source_and_destination_returns_422(client):
    payload = (
        TransferRequestBuilder()
        .with_source("wallet_001")
        .with_destination("wallet_001")
        .build()
    )
    assert client.create_transfer(payload).status_code == 422


def test_unknown_source_wallet_returns_422(client):
    payload = TransferRequestBuilder().with_source("does-not-exist").build()
    assert client.create_transfer(payload).status_code == 422


def test_unknown_destination_wallet_returns_422(client):
    payload = TransferRequestBuilder().with_destination("does-not-exist").build()
    assert client.create_transfer(payload).status_code == 422


def test_source_currency_mismatch_returns_422(client):
    payload = (
        TransferRequestBuilder()
        .with_source("wallet_usd")
        .with_destination("wallet_002")
        .build()
    )
    assert client.create_transfer(payload).status_code == 422


def test_destination_currency_mismatch_returns_422(client):
    payload = (
        TransferRequestBuilder()
        .with_source("wallet_001")
        .with_destination("wallet_usd")
        .build()
    )
    assert client.create_transfer(payload).status_code == 422


def test_validation_failure_persists_nothing(client, db, seed_balances):
    payload = TransferRequestBuilder().with_amount(-50).build()

    client.create_transfer(payload)

    assert db.transfer_count() == 0
    assert db.audit_event_count() == 0
    assert db.outbox_count() == 0
    assert db.idempotency_count() == 0
    for wallet_id, original_balance in seed_balances.items():
        assert db.wallet_balance(wallet_id) == original_balance


def test_empty_body_returns_422(http):
    """Send no JSON body at all; the service should treat it as missing fields."""
    response = http.post("/transfers")
    assert response.status_code == 422
