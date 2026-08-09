"""Insufficient balance: transfer must be rejected with NO state change.

Distinct from the "in-flight failure" path covered in
tests/cross_component/test_failure_dlq.py: insufficient-balance is a
*pre-flight* rejection (422), so the system never touches the state machine,
never inserts a transfer row, and never emits any event.
"""

from tests.support.builders import TransferRequestBuilder
from tests.support.invariants import (
    assert_no_balance_movement,
    assert_no_transfer_rows,
)


def test_insufficient_balance_returns_422(client):
    payload = TransferRequestBuilder().with_amount(999_999).build()
    response = client.create_transfer(payload)
    assert response.status_code == 422
    assert "error" in response.get_json()


def test_insufficient_balance_does_not_move_money(client, db, seed_balances):
    payload = TransferRequestBuilder().with_amount(999_999).build()

    client.create_transfer(payload)

    assert_no_balance_movement(db, seed_balances)


def test_insufficient_balance_persists_no_transfer(client, db):
    payload = TransferRequestBuilder().with_amount(999_999).build()
    client.create_transfer(payload)
    assert_no_transfer_rows(db)


def test_insufficient_balance_writes_no_outbox(client, db):
    payload = TransferRequestBuilder().with_amount(999_999).build()
    client.create_transfer(payload)
    assert db.outbox_count() == 0


def test_insufficient_balance_writes_no_audit(client, db):
    payload = TransferRequestBuilder().with_amount(999_999).build()
    client.create_transfer(payload)
    assert db.audit_event_count() == 0


def test_zero_balance_wallet_cannot_send(client, db, seed_balances):
    payload = (
        TransferRequestBuilder()
        .with_source("wallet_003")
        .with_destination("wallet_001")
        .with_amount(1)
        .build()
    )
    response = client.create_transfer(payload)
    assert response.status_code == 422
    assert_no_balance_movement(db, seed_balances)


def test_exact_balance_transfer_succeeds(client, db):
    """Boundary: sending the full balance should be allowed, not rejected."""
    payload = TransferRequestBuilder().with_amount(10_000).build()
    response = client.create_transfer(payload)
    assert response.status_code == 201
    assert db.wallet_balance("wallet_001") == 0
    assert db.wallet_balance("wallet_002") == 15_000


def test_one_over_balance_rejected(client, db, seed_balances):
    """Boundary on the other side: balance + 1 must be rejected."""
    payload = TransferRequestBuilder().with_amount(10_001).build()
    response = client.create_transfer(payload)
    assert response.status_code == 422
    assert_no_balance_movement(db, seed_balances)
