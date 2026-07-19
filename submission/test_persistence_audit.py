"""
Category F -- Persistence and Auditability.

Cross-checks that persisted records are internally consistent with each
other, not just individually correct.
"""
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import get_transfer_by_id, get_events_for_transfer, get_outbox_events_for_transfer


def test_transfer_record_matches_api_visible_result_exactly(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=4200, reference="po_9911"), new_idempotency_key())
    body = resp.json()

    row = get_transfer_by_id(db_session, body["transfer_id"])
    assert row.status == body["status"]
    assert row.amount == body["amount"]
    assert row.reference == body["reference"]
    assert row.currency == body["currency"]


def test_no_contradictory_records_for_rejected_transfer(client, db_session, seeded_wallets):
    """A REJECTED transfer must never have a transfer.completed outbox event."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    outbox = get_outbox_events_for_transfer(db_session, transfer_id)
    event_types = {e.event_type for e in outbox}
    assert "transfer.completed" not in event_types


def test_event_timestamps_are_non_decreasing(client, db_session, seeded_wallets):
    """CREATED must not be timestamped after COMPLETED -- lifecycle ordering sanity."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=100), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    events = get_events_for_transfer(db_session, transfer_id)
    timestamps = [e.created_at for e in events]
    assert timestamps == sorted(timestamps)


def test_transfer_status_transition_is_valid_terminal_state(client, db_session, seeded_wallets):
    """Once COMPLETED, a transfer must not be mutable to REJECTED (or vice versa) by replay."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=100)

    first_resp = api.post_transfer(payload, key)
    api.post_transfer(payload, key)  # replay

    row = get_transfer_by_id(db_session, first_resp.json()["transfer_id"])
    assert row.status == "COMPLETED"
