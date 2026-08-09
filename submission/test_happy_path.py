"""
Category A -- Happy Path Transfer.

Proves the full path: API response -> DB balances -> transfer record ->
audit events -> outbox, all agree with each other.
"""
from app.models import Transfer
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import (
    get_wallet_balance,
    get_transfer_by_id,
    get_events_for_transfer,
    get_outbox_events_for_transfer,
)


def test_successful_transfer_returns_201_with_completed_status(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    payload = transfer_payload(source, destination, amount=2500)

    resp = api.post_transfer(payload, new_idempotency_key())

    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "COMPLETED"
    assert body["source_wallet_id"] == source.id
    assert body["destination_wallet_id"] == destination.id
    assert body["amount"] == 2500


def test_source_wallet_debited_exactly_once(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    starting_balance = source.balance

    api.post_transfer(transfer_payload(source, destination, amount=2500), new_idempotency_key())

    assert get_wallet_balance(db_session, source.id) == starting_balance - 2500


def test_destination_wallet_credited_exactly_once(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    starting_balance = destination.balance

    api.post_transfer(transfer_payload(source, destination, amount=2500), new_idempotency_key())

    assert get_wallet_balance(db_session, destination.id) == starting_balance + 2500


def test_total_balance_conserved_across_both_wallets(client, db_session, seeded_wallets):
    """Money should move, not be created or destroyed."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    total_before = source.balance + destination.balance

    api.post_transfer(transfer_payload(source, destination, amount=1500), new_idempotency_key())

    total_after = get_wallet_balance(db_session, source.id) + get_wallet_balance(db_session, destination.id)
    assert total_after == total_before


def test_persisted_transfer_record_matches_api_response(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=777, reference="invoice_777"), new_idempotency_key())
    body = resp.json()

    row = get_transfer_by_id(db_session, body["transfer_id"])
    assert row is not None
    assert row.status == "COMPLETED"
    assert row.amount == 777
    assert row.reference == "invoice_777"
    assert row.source_wallet_id == source.id
    assert row.destination_wallet_id == destination.id


def test_audit_events_recorded_for_completed_transfer(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=500), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    events = get_events_for_transfer(db_session, transfer_id)
    event_types = [e.event_type for e in events]
    assert event_types == ["CREATED", "COMPLETED"], (
        "expected an append-only CREATED -> COMPLETED lifecycle with no gaps or reordering"
    )


def test_outbox_event_written_exactly_once_for_completed_transfer(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=500), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    outbox_rows = get_outbox_events_for_transfer(db_session, transfer_id)
    assert len(outbox_rows) == 1
    assert outbox_rows[0].event_type == "transfer.completed"


def test_get_transfer_reflects_same_state_as_post_response(client, seeded_wallets):
    """Read-after-write consistency for the read endpoint."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    post_resp = api.post_transfer(transfer_payload(source, destination, amount=333), new_idempotency_key())
    transfer_id = post_resp.json()["transfer_id"]

    get_resp = api.get_transfer(transfer_id)
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "COMPLETED"
    assert get_resp.json()["amount"] == 333
