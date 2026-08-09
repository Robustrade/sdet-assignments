"""
Category C -- Insufficient Balance.

Insufficient balance is a *business* rejection, not a validation error --
so unlike Category B, we expect a Transfer row to exist (status=REJECTED)
for auditability, but wallet balances must be untouched.
"""
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import get_wallet_balance, get_transfer_by_id, get_events_for_transfer


def test_transfer_rejected_when_amount_exceeds_balance(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets  # source has 10_000

    resp = api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())

    assert resp.status_code == 422
    assert resp.json()["status"] == "REJECTED"
    assert resp.json()["failure_reason"] == "INSUFFICIENT_BALANCE"


def test_balances_unchanged_after_rejection(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    s_bal, d_bal = source.balance, destination.balance

    api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())

    assert get_wallet_balance(db_session, source.id) == s_bal
    assert get_wallet_balance(db_session, destination.id) == d_bal


def test_rejected_transfer_is_persisted_with_correct_status(client, db_session, seeded_wallets):
    """A rejected transfer should still be auditable -- not silently dropped."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    row = get_transfer_by_id(db_session, transfer_id)
    assert row is not None
    assert row.status == "REJECTED"
    assert row.failure_reason == "INSUFFICIENT_BALANCE"


def test_rejected_transfer_has_rejected_audit_event_only(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    events = get_events_for_transfer(db_session, transfer_id)
    assert [e.event_type for e in events] == ["REJECTED"], "no COMPLETED event should exist for a failed transfer"


def test_exact_balance_transfer_succeeds_boundary(client, db_session, seeded_wallets):
    """Boundary check: amount == balance should succeed (not treated as > balance)."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    exact_amount = source.balance

    resp = api.post_transfer(transfer_payload(source, destination, amount=exact_amount), new_idempotency_key())

    assert resp.status_code == 201
    assert get_wallet_balance(db_session, source.id) == 0
