"""Happy path: successful transfers with multi-layer validation.

Validates: API response, DB balances, transfer record, audit event,
outbox event, and API-to-DB consistency.
"""

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.builders import transfer_payload, unique_idempotency_key
from tests.helpers.db_helpers import (
    get_audit_events_for_transfer,
    get_outbox_events_for_transfer,
    get_transfer_by_id,
    get_wallet_balance,
)


def test_transfer_returns_201_with_correct_body(client):
    """API layer: successful transfer returns 201 with expected fields."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(
        amount=2500,
        reference="invoice_123",
        idempotency_key="hp-001",
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "completed"
    assert body["amount"] == 2500
    assert body["source_wallet_id"] == "wallet_001"
    assert body["destination_wallet_id"] == "wallet_002"
    assert body["currency"] == "AED"
    assert "id" in body
    assert "created_at" in body


def test_source_balance_decremented(client, app):
    """DB layer: source wallet balance decreases by transfer amount."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=1000)
    assert get_wallet_balance(app.db, "wallet_001") == 9000


def test_destination_balance_incremented(client, app):
    """DB layer: destination wallet balance increases by transfer amount."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=1000)
    assert get_wallet_balance(app.db, "wallet_002") == 6000


def test_net_balance_movement_equals_amount(client, app):
    """Business invariant: source debit + destination credit = transfer amount."""
    before_src = get_wallet_balance(app.db, "wallet_001")
    before_dst = get_wallet_balance(app.db, "wallet_002")

    api = TransferAPIClient(client)
    api.create_transfer(amount=3000)

    after_src = get_wallet_balance(app.db, "wallet_001")
    after_dst = get_wallet_balance(app.db, "wallet_002")

    assert before_src - after_src == 3000  # debited exactly 3000
    assert after_dst - before_dst == 3000  # credited exactly 3000


def test_total_system_balance_conserved(client, app):
    """Business invariant: total balance across all wallets is unchanged."""
    from tests.helpers.db_helpers import get_total_wallet_balance

    total_before = get_total_wallet_balance(app.db)

    api = TransferAPIClient(client)
    api.create_transfer(amount=2000)

    total_after = get_total_wallet_balance(app.db)
    assert total_before == total_after  # money is neither created nor destroyed


def test_transfer_record_persisted_correctly(client, app):
    """DB layer: transfer row exists with correct field values."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500, reference="ref-1")
    transfer_id = resp.get_json()["id"]

    row = get_transfer_by_id(app.db, transfer_id)
    assert row is not None
    assert row["status"] == "completed"
    assert row["amount"] == 500
    assert row["source_wallet_id"] == "wallet_001"
    assert row["destination_wallet_id"] == "wallet_002"
    assert row["reference"] == "ref-1"


def test_audit_event_created_for_transfer(client, app):
    """Cross-component: audit_events row written with correct type."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500)
    transfer_id = resp.get_json()["id"]

    events = get_audit_events_for_transfer(app.db, transfer_id)
    assert len(events) == 1
    assert events[0]["event_type"] == "transfer_completed"


def test_outbox_event_created_for_transfer(client, app):
    """Cross-component: outbox_events row written in 'pending' status."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500)
    transfer_id = resp.get_json()["id"]

    outbox = get_outbox_events_for_transfer(app.db, transfer_id)
    assert len(outbox) == 1
    assert outbox[0]["event_type"] == "transfer_completed"
    assert outbox[0]["status"] == "pending"


def test_get_transfer_returns_correct_state(client):
    """API layer: GET /transfers/{id} returns the persisted transfer."""
    api = TransferAPIClient(client)
    post_resp = api.create_transfer(amount=300)
    transfer_id = post_resp.get_json()["id"]

    get_resp = api.get_transfer(transfer_id)
    assert get_resp.status_code == 200
    assert get_resp.get_json()["status"] == "completed"
    assert get_resp.get_json()["amount"] == 300


def test_get_wallet_reflects_updated_balance(client):
    """API layer: GET /wallets/{id} reflects the post-transfer balance."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=2000)

    resp = api.get_wallet("wallet_001")
    assert resp.status_code == 200
    assert resp.get_json()["balance"] == 8000


def test_api_and_db_transfer_state_consistent(client, app):
    """Cross-layer: API response fields match DB transfer row exactly."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=750)
    api_body = resp.get_json()

    db_row = get_transfer_by_id(app.db, api_body["id"])
    assert db_row is not None
    assert db_row["status"] == api_body["status"]
    assert db_row["amount"] == api_body["amount"]
    assert db_row["source_wallet_id"] == api_body["source_wallet_id"]
    assert db_row["destination_wallet_id"] == api_body["destination_wallet_id"]
    assert db_row["currency"] == api_body["currency"]

