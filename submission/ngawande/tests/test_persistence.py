"""Tests that API responses match what's actually in the database.

Checks that:
- Fields returned by the API are the same as fields stored in DB
- Wallet balance from API matches direct DB query
- Audit event data is correct and consistent
- No orphan records exist (events without matching transfers)
"""

import json

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.db_helpers import (
    get_audit_events_for_transfer,
    get_outbox_events_for_transfer,
    get_transfer_by_id,
    get_wallet_balance,
)


def test_api_transfer_matches_db_row(client, app):
    """Every field in the API response must match the corresponding DB row."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=1234, reference="persist-1")
    body = resp.get_json()

    db_row = get_transfer_by_id(app.db, body["id"])
    assert db_row is not None
    for field in ("id", "source_wallet_id", "destination_wallet_id", "amount",
                  "currency", "reference", "status", "idempotency_key", "created_at"):
        assert db_row[field] == body[field], (
            f"Mismatch on '{field}': DB={db_row[field]} vs API={body[field]}"
        )


def test_api_wallet_balance_matches_db(client, app):
    """GET /wallets balance must match direct DB query after transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=1500)

    api_balance = api.get_wallet("wallet_001").get_json()["balance"]
    db_balance = get_wallet_balance(app.db, "wallet_001")
    assert api_balance == db_balance == 8_500


def test_audit_event_payload_matches_transfer(client, app):
    """Audit event payload must contain correct amount and currency."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=800, currency="AED")
    transfer_id = resp.get_json()["id"]

    events = get_audit_events_for_transfer(app.db, transfer_id)
    assert len(events) == 1
    payload = json.loads(events[0]["payload"])
    assert payload["amount"] == 800
    assert payload["currency"] == "AED"


def test_audit_event_timestamp_coherent(client, app):
    """Audit event created_at must not be empty and must roughly match transfer."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500)
    transfer_id = resp.get_json()["id"]

    transfer = get_transfer_by_id(app.db, transfer_id)
    events = get_audit_events_for_transfer(app.db, transfer_id)
    assert len(events) == 1
    # Timestamps should be in the same second (both set from datetime.now)
    assert transfer["created_at"][:19] == events[0]["created_at"][:19]


def test_no_orphan_audit_events(client, app):
    """Every audit event must reference an existing transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=500)

    orphans = app.db.execute(
        "SELECT ae.id FROM audit_events ae"
        " LEFT JOIN transfers t ON ae.transfer_id = t.id"
        " WHERE t.id IS NULL"
    ).fetchall()
    assert len(orphans) == 0


def test_no_orphan_outbox_events(client, app):
    """Every outbox event must reference an existing transfer."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=500)

    orphans = app.db.execute(
        "SELECT oe.id FROM outbox_events oe"
        " LEFT JOIN transfers t ON oe.transfer_id = t.id"
        " WHERE t.id IS NULL"
    ).fetchall()
    assert len(orphans) == 0


def test_get_nonexistent_transfer_returns_404(client):
    """API layer: GET for a non-existent transfer returns 404."""
    api = TransferAPIClient(client)
    resp = api.get_transfer("nonexistent-id")
    assert resp.status_code == 404


def test_get_nonexistent_wallet_returns_404(client):
    """API layer: GET for a non-existent wallet returns 404."""
    api = TransferAPIClient(client)
    resp = api.get_wallet("nonexistent-id")
    assert resp.status_code == 404

